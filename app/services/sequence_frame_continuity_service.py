"""SequenceFrameContinuityModule v1 (PATCH_SequenceFrameContinuityModule_v1).

Extracts and archives the REAL last frame of completed SequenceQueue clips as
portable sequence assets (assets/continuity_frames/), registers them in
sequence.json with relative paths only, and lets the user create a new Image
Reference clip from a saved frame.

Hard rules (patch §2/§4/§17):
- works only with real generated videos and real extracted frames;
- never starts rendering, never auto-uses a previous frame for the next clip;
- extraction failure is a non-blocking warning — the completed clip is kept;
- ffmpeg is invoked as an argument list with a timeout (never shell=True);
- no absolute paths in sequence.json, no path traversal, sanitized filenames.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import uuid
from pathlib import Path

from app.config import logger
from app.models.sequence_models import (
    ClipStatus,
    ClipType,
    ContinuityFrame,
    CreatedFromFrame,
    SequenceClip,
    VideoSequence,
    utc_now,
)
from app.services import sequence_service
from app.services.audio_service import resolve_ffmpeg
from app.services.sequence_service import SequenceError

CONTINUITY_SUBDIR = Path("assets") / "continuity_frames"
FRAME_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")

_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_-]+")


class ContinuityError(Exception):
    """Raised for continuity-frame failures with a user-readable message."""


# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

def continuity_frames_dir(seq: VideoSequence) -> Path:
    """The sequence's continuity-frame asset folder (created on demand)."""
    d = sequence_service.sequence_dir(seq.folder) / CONTINUITY_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _frame_filename(clip: SequenceClip) -> str:
    """Deterministic frame name keyed by clip_id (stable across reordering, so
    re-extraction overwrites only this clip's own registered frame)."""
    safe_id = _SAFE_ID_RE.sub("", clip.clip_id) or uuid.uuid4().hex[:10]
    return f"clip_{safe_id}_last_frame.png"


def resolve_best_clip_video(seq: VideoSequence, clip: SequenceClip) -> tuple[Path, str] | None:
    """The best available REAL visual output of a clip (§7.2 priority:
    final -> fx -> raw). Returns (absolute path, sequence-relative label) or
    None when no real video exists on disk."""
    cdir = sequence_service.clip_dir(seq, clip)
    for stage in ("final", "fx", "raw"):
        name = getattr(clip.outputs, stage)
        if not name:
            continue
        path = cdir / stage / Path(name).name
        if path.exists() and path.is_file() and path.stat().st_size > 0:
            rel = f"clips/{cdir.name}/{stage}/{path.name}"
            return path, rel
    return None


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def extract_last_frame(seq: VideoSequence, clip: SequenceClip) -> tuple[str, str]:
    """Extract the last frame of the clip's best video into
    assets/continuity_frames/. Returns (frame filename, source relative label).
    Raises ContinuityError on failure — callers treat it as a warning."""
    resolved = resolve_best_clip_video(seq, clip)
    if resolved is None:
        raise ContinuityError("No rendered video file exists for this clip yet.")
    src, source_rel = resolved

    out_dir = continuity_frames_dir(seq)
    out = out_dir / _frame_filename(clip)
    ffmpeg = resolve_ffmpeg()

    # Fast path: seek ~1s before EOF and keep updating one image -> last frame.
    # Fallback: decode the whole (short) clip the same way if the seek fails.
    attempts = (
        [ffmpeg, "-hide_banner", "-y", "-sseof", "-1", "-i", str(src),
         "-update", "1", "-frames:v", "120", str(out)],
        [ffmpeg, "-hide_banner", "-y", "-i", str(src), "-update", "1", str(out)],
    )
    last_err = ""
    for cmd in attempts:
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=300)
        except subprocess.TimeoutExpired as exc:
            raise ContinuityError("Last-frame extraction timed out after 5 minutes.") from exc
        if proc.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return out.name, source_rel
        tail = proc.stderr.decode("utf-8", errors="replace").strip().splitlines()[-3:]
        last_err = " ".join(tail)
        out.unlink(missing_ok=True)
    raise ContinuityError("FFmpeg could not extract the last frame: "
                          + (last_err or "unknown error"))


def register_continuity_frame(clip: SequenceClip, frame_filename: str, source_output: str) -> None:
    """Record the saved frame on the clip with a sequence-relative path only."""
    clip.continuity_frame = ContinuityFrame(
        available=True,
        frame_type="last_frame",
        path=(CONTINUITY_SUBDIR / frame_filename).as_posix(),
        source_output=source_output,
        created_at=utc_now(),
    )


def extract_for_completed_clip(seq: VideoSequence, clip: SequenceClip) -> str | None:
    """Post-render hook used by the queue runner: extract + register the last
    frame of a just-completed clip when the sequence setting is enabled.

    Returns a log message, or None when the feature is disabled. Mutates the
    caller's in-memory seq/clip — the caller persists. Raises ContinuityError
    on failure (the queue treats it as a non-blocking warning)."""
    if not seq.frame_continuity.save_last_frame:
        return None
    if clip.status != ClipStatus.COMPLETED:
        return None
    frame_name, source_rel = extract_last_frame(seq, clip)
    register_continuity_frame(clip, frame_name, source_rel)
    return f"last frame saved -> {clip.continuity_frame.path} (from {source_rel})"


def extract_now(sequence_id: str, clip_id: str) -> SequenceClip:
    """Manual (re-)extraction for one completed clip (§16, optional endpoint)."""
    from app.services.sequence_queue_service import queue_manager

    if queue_manager.is_running(sequence_id):
        raise ContinuityError("The sequence is currently rendering. Wait for it to finish.")
    seq = sequence_service.load_sequence(sequence_id)
    clip = seq.get_clip(clip_id)
    if clip is None:
        raise ContinuityError(f"Clip '{clip_id}' not found.")
    if clip.status != ClipStatus.COMPLETED:
        raise ContinuityError("Only completed clips have a real last frame to extract.")
    frame_name, source_rel = extract_last_frame(seq, clip)
    register_continuity_frame(clip, frame_name, source_rel)
    sequence_service.save_sequence(seq)
    logger.info("Continuity frame extracted for sequence '%s' clip %s -> %s",
                seq.name, clip.clip_id, clip.continuity_frame.path)
    return clip


# --------------------------------------------------------------------------
# Create new Image Reference clip from a saved frame (§12)
# --------------------------------------------------------------------------

def _registered_frame_path(seq: VideoSequence, clip: SequenceClip) -> Path:
    """Resolve the clip's REGISTERED continuity frame safely inside
    assets/continuity_frames/, refusing traversal and unregistered files."""
    cf = clip.continuity_frame
    if not cf.available or not cf.path:
        raise ContinuityError("This clip has no saved last frame.")
    name = Path(cf.path).name
    if not name or name != Path(name).name or Path(name).suffix.lower() not in FRAME_EXTENSIONS:
        raise ContinuityError("Invalid continuity frame file name.")
    base = continuity_frames_dir(seq).resolve()
    path = (base / name).resolve()
    if base not in path.parents:
        raise ContinuityError("Invalid continuity frame path.")
    if not path.exists() or not path.is_file():
        raise ContinuityError("The saved last frame file is missing on disk — re-extract it.")
    return path


def create_clip_from_frame(sequence_id: str, source_clip_id: str) -> SequenceClip:
    """Create a new Image Reference clip from a clip's saved last frame.

    The new clip copies the source clip's positive/negative prompts, uses the
    frame as its source image, is inserted right after the source clip, is
    marked ready, and NEVER starts rendering (§12)."""
    from app.services.sequence_queue_service import queue_manager

    if queue_manager.is_running(sequence_id):
        raise ContinuityError("The sequence is currently rendering. Wait for it to finish.")
    seq = sequence_service.load_sequence(sequence_id)
    source = seq.get_clip(source_clip_id)
    if source is None:
        raise ContinuityError(f"Clip '{source_clip_id}' not found.")
    frame_path = _registered_frame_path(seq, source)

    # Copy the frame into assets/images so the new clip flows through the
    # existing, already-safe Image Reference pipeline (stage_source_image).
    images_dir = sequence_service.assets_images_dir(seq)
    image_name = sequence_service._safe_unique(images_dir, frame_path.name)
    shutil.copy2(frame_path, images_dir / image_name)

    new_clip = SequenceClip(
        clip_id=uuid.uuid4().hex[:10],
        name=f"{source.name} - From last frame"[:120].strip(),
        type=ClipType.IMAGE_REFERENCE,
        source_image=image_name,
        image_fit=source.image_fit or "contain",
        prompt=source.prompt,
        negative_prompt=source.negative_prompt,
        created_from_frame=CreatedFromFrame(
            source_clip_id=source.clip_id,
            source_frame_path=source.continuity_frame.path,
            source_frame_type=source.continuity_frame.frame_type or "last_frame",
        ),
    )
    pos = seq.clips.index(source) + 1
    seq.clips.insert(pos, new_clip)
    seq.reindex()
    sequence_service.save_sequence(seq)
    logger.info("Clip created from continuity frame in sequence '%s': %s -> %s ('%s')",
                seq.name, source.clip_id, new_clip.clip_id, new_clip.name)
    return new_clip


# --------------------------------------------------------------------------
# Safe media resolution (§11)
# --------------------------------------------------------------------------

def resolve_continuity_frame_media(sequence_id: str, filename: str) -> Path:
    """Resolve a continuity frame image for serving. Only REGISTERED frames of
    the sequence's clips are served — never arbitrary files (§11/§17)."""
    name = (filename or "").strip()
    if (not name or name != Path(name).name or ".." in name
            or Path(name).suffix.lower() not in FRAME_EXTENSIONS):
        raise ContinuityError("Invalid continuity frame file name.")
    seq = sequence_service.load_sequence(sequence_id)  # may raise SequenceError
    registered = {Path(c.continuity_frame.path).name
                  for c in seq.clips if c.continuity_frame.available and c.continuity_frame.path}
    if name not in registered:
        raise ContinuityError("This file is not a registered continuity frame of the sequence.")
    base = continuity_frames_dir(seq).resolve()
    path = (base / name).resolve()
    if base not in path.parents or not path.exists() or not path.is_file():
        raise ContinuityError("Continuity frame file not found.")
    return path


__all__ = [
    "ContinuityError",
    "SequenceError",
    "continuity_frames_dir",
    "resolve_best_clip_video",
    "extract_last_frame",
    "register_continuity_frame",
    "extract_for_completed_clip",
    "extract_now",
    "create_clip_from_frame",
    "resolve_continuity_frame_media",
]
