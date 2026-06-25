import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

_SERVER_DIR = Path(__file__).resolve().parent
_STATIC_DIR = _SERVER_DIR.parent / "client" / "dist"

load_dotenv(_SERVER_DIR / ".env")

from config import settings
from transcribe import dictate_text, transcribe_bytes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Soda Transcriptions API ready (port %s)", settings.API_PORT)
    yield


app = FastAPI(title="Soda Transcriptions", lifespan=lifespan)

_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "openai_configured": bool(settings.OPENAI_API_KEY)}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="Empty file")

    if len(body) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {settings.MAX_UPLOAD_SIZE} bytes.",
        )

    text, err = transcribe_bytes(file.filename, body)
    if err:
        if "OPENAI_API_KEY" in err:
            raise HTTPException(status_code=503, detail=err)
        raise HTTPException(status_code=502, detail=err)

    return {"text": text}


class DictateRequest(BaseModel):
    text: str


@app.post("/dictate")
async def dictate(payload: DictateRequest):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    if len(text) > 4000:
        raise HTTPException(status_code=413, detail="Text too long. Maximum length is 4000 characters.")

    audio, err = dictate_text(text)
    if err:
        if "OPENAI_API_KEY" in err:
            raise HTTPException(status_code=503, detail=err)
        raise HTTPException(status_code=502, detail=err)

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Content-Disposition": 'inline; filename="dictation.mp3"'},
    )


if _STATIC_DIR.is_dir() and (_STATIC_DIR / "index.html").is_file():
    app.mount(
        "/",
        StaticFiles(directory=str(_STATIC_DIR), html=True),
        name="spa",
    )
