# Soda Transcriptions

Small local-only app: upload audio or video to get text via OpenAI Whisper (`whisper-1`), and convert text into spoken audio (MP3) via OpenAI TTS.

## Credentials

1. **`server/.env`** must define `OPENAI_API_KEY`.
2. To reuse the key from the main project:

   ```bash
   cp ../project-status-tracker/server/.env server/.env
   ```

   Then trim `server/.env` if you like so it only contains variables this app reads (`OPENAI_API_KEY`, optional `MAX_UPLOAD_SIZE`, `API_PORT`, `CORS_ORIGINS`). The app ignores extra keys.

3. Template without secrets: **`server/.env.example`**.

## Run the API

[Poetry](https://python-poetry.org/docs/#installation) manages dependencies (`server/pyproject.toml` and `server/poetry.lock`). One-time setup installs packages into `server/.venv` (see `server/poetry.toml`).

```bash
cd server
poetry install
poetry run uvicorn main:app --reload --host 127.0.0.1 --port 8765
```

Default port is **8765** (set `API_PORT` in `.env` if you change it consistently).

When **`client/dist/`** exists (after `npm run build` in `client/`), the same server also serves the web UI at **`http://127.0.0.1:<port>/`**, so you only need one process for daily use.

- `GET /health` — includes `openai_configured` (boolean).
- `POST /transcribe` — multipart field `file`; JSON response `{ "text": "..." }`.
- `POST /dictate` — JSON body `{ "text": "..." }`; response is `audio/mpeg` (MP3 bytes).

## Run the UI (development)

```bash
cd client
cp .env.example .env   # sets VITE_API_BASE_URL=http://localhost:8765
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). CORS allows `5173` and `5174` by default; override with `CORS_ORIGINS` in `server/.env` if you use another port.

The web UI can **record from the microphone** (Record tab) as well as upload a file; use **https** or **localhost** and allow the browser’s microphone permission when prompted.

Production build (`npm run build`) uses **`client/.env.production`** so the UI talks to the API on the same origin when served by FastAPI.

## Use as a Mac app (Dock / double‑click)

1. One-time: `cd server && poetry install`, `cd client && npm install && npm run build`, and ensure **`server/.env`** has a real **`OPENAI_API_KEY`**.
2. Open **`mac/Soda Transcriptions.app`** (or drag it to **Applications** and optionally pin to the Dock).

The app starts the API with Poetry, waits until `/health` responds, opens your default browser to the UI, and stays running until you quit it from the Dock (**Cmd+Q**). You need **Poetry** on your `PATH` (same as when you develop); GUI apps only see a short default `PATH`, so the launcher prepends Homebrew and `~/.local/bin`.

**Gatekeeper:** the first run may require **Right‑click → Open** (or **System Settings → Privacy & Security → Open Anyway**) because the bundle is not Apple‑notarized.

## Limits

`MAX_UPLOAD_SIZE` defaults to 100 MB (same order of magnitude as the tracker). Very large files are read fully into memory before calling the API.
