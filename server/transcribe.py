import logging
from pathlib import Path
from typing import Optional, Tuple

from openai import OpenAI

from config import settings

logger = logging.getLogger(__name__)

CONTENT_TYPE_MAP = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
    ".mp4": "video/mp4",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
}


def content_type_for_filename(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return CONTENT_TYPE_MAP.get(ext, "audio/mpeg")


def get_openai_client() -> Optional[OpenAI]:
    if not settings.OPENAI_API_KEY:
        return None
    try:
        return OpenAI(api_key=settings.OPENAI_API_KEY)
    except Exception as e:
        logger.error("Failed to initialize OpenAI client: %s", e)
        return None


def transcribe_bytes(filename: str, file_content: bytes) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (transcript_text, error_message). One of the two is set.
    """
    client = get_openai_client()
    if not client:
        return None, "OPENAI_API_KEY is not set or invalid. Add it to server/.env"

    content_type = content_type_for_filename(filename)
    safe_name = Path(filename).name or "recording.mp3"

    try:
        transcription = client.audio.transcriptions.create(
            model="whisper-1",
            file=(safe_name, file_content, content_type),
            response_format="text",
        )
        if isinstance(transcription, str):
            return transcription, None
        if hasattr(transcription, "text"):
            return transcription.text, None
        return None, "Unexpected response format from transcription API"
    except Exception as e:
        logger.exception("Transcription failed")
        return None, str(e)


def dictate_text(text: str) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Returns (audio_bytes, error_message). One of the two is set.
    """
    client = get_openai_client()
    if not client:
        return None, "OPENAI_API_KEY is not set or invalid. Add it to server/.env"

    try:
        speech = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            voice="alloy",
            input=text,
            response_format="mp3",
        )
        data = getattr(speech, "content", None)
        if isinstance(data, (bytes, bytearray)):
            return bytes(data), None
        return None, "Unexpected response format from speech API"
    except Exception as e:
        logger.exception("Dictation failed")
        return None, str(e)
