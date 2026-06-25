import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const envUrl = import.meta.env.VITE_API_BASE_URL
const apiBase =
  envUrl !== undefined
    ? envUrl.replace(/\/$/, '')
    : import.meta.env.DEV
      ? 'http://localhost:8765'
      : ''

type InputMode = 'file' | 'record'

const RECORDER_MIME_CANDIDATES = [
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/mp4', ext: 'm4a' },
] as const

function pickRecorderMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const { mime, ext } of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext }
    }
  }
  return null
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

function formatRecordTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const [inputMode, setInputMode] = useState<InputMode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dictationInput, setDictationInput] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [generatingAudio, setGeneratingAudio] = useState(false)
  const [copied, setCopied] = useState(false)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const mimePickRef = useRef<{ mime: string; ext: string } | null>(null)
  const discardRecordingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  useEffect(() => {
    if (!isRecording) return
    const id = window.setInterval(() => {
      setRecordingSeconds((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [isRecording])

  const resetTranscriptUi = useCallback(() => {
    setError(null)
    setText('')
    setCopied(false)
  }, [])

  const teardownRecorder = useCallback(() => {
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null
    stopMediaStream(streamRef.current)
    streamRef.current = null
    chunksRef.current = []
    mimePickRef.current = null
    setIsRecording(false)
    setRecordingSeconds(0)
  }, [])

  useEffect(() => {
    return () => {
      discardRecordingRef.current = true
      teardownRecorder()
    }
  }, [teardownRecorder])

  const switchMode = useCallback(
    (mode: InputMode) => {
      if (mode === inputMode) return
      resetTranscriptUi()
      if (isRecording) {
        discardRecordingRef.current = true
        const rec = mediaRecorderRef.current
        if (rec && rec.state !== 'inactive') {
          rec.stop()
        } else {
          teardownRecorder()
        }
      } else {
        teardownRecorder()
      }
      setFile(null)
      setInputMode(mode)
    },
    [inputMode, isRecording, resetTranscriptUi, teardownRecorder],
  )

  const onFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0]
      resetTranscriptUi()
      if (f) {
        setInputMode('file')
        setFile(f)
      }
    },
    [resetTranscriptUi],
  )

  const startRecording = async () => {
    if (isRecording) return
    const picked = pickRecorderMime()
    if (!picked) {
      setError('Recording is not supported in this browser (no compatible audio format).')
      return
    }
    resetTranscriptUi()
    setFile(null)
    discardRecordingRef.current = false
    chunksRef.current = []
    mimePickRef.current = picked
    setRecordingSeconds(0)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access was denied or unavailable.')
      mimePickRef.current = null
      return
    }

    streamRef.current = stream

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType: picked.mime })
    } catch {
      stopMediaStream(stream)
      streamRef.current = null
      mimePickRef.current = null
      setError('Could not start the audio recorder.')
      return
    }

    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    recorder.onstop = () => {
      const shouldDiscard = discardRecordingRef.current
      discardRecordingRef.current = false
      const chunks = chunksRef.current
      const mime = mimePickRef.current
      chunksRef.current = []
      mimePickRef.current = null
      stopMediaStream(streamRef.current)
      streamRef.current = null
      mediaRecorderRef.current = null
      setIsRecording(false)
      setRecordingSeconds(0)

      if (shouldDiscard) return

      const blobType = mime?.mime ?? 'audio/webm'
      const ext = mime?.ext ?? 'webm'
      const blob = new Blob(chunks, { type: blobType })
      if (!blob.size) {
        setError('Recording was empty.')
        return
      }
      setFile(new File([blob], `recording.${ext}`, { type: blobType }))
    }

    recorder.start(250)
    setIsRecording(true)
    setError(null)
  }

  const stopRecording = () => {
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    }
  }

  const transcribe = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${apiBase}/transcribe`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof data?.detail === 'string'
            ? data.detail
            : Array.isArray(data?.detail)
              ? data.detail.map((d: { msg?: string }) => d.msg || '').join(' ')
              : res.statusText
        throw new Error(detail || `Request failed (${res.status})`)
      }
      setText(typeof data?.text === 'string' ? data.text : '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed')
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard')
    }
  }

  const dictate = async () => {
    const payload = dictationInput.trim()
    if (!payload) return

    setGeneratingAudio(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/dictate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: payload }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const detail =
          typeof data?.detail === 'string'
            ? data.detail
            : Array.isArray(data?.detail)
              ? data.detail.map((d: { msg?: string }) => d.msg || '').join(' ')
              : res.statusText
        throw new Error(detail || `Request failed (${res.status})`)
      }

      const blob = await res.blob()
      if (!blob.size) {
        throw new Error('Empty audio response')
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      setAudioBlob(blob)
      setAudioUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Audio generation failed')
    } finally {
      setGeneratingAudio(false)
    }
  }

  const downloadAudio = () => {
    if (!audioBlob || !audioUrl) return
    const a = document.createElement('a')
    a.href = audioUrl
    a.download = 'dictation.mp3'
    a.click()
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Soda Transcriptions</h1>
        <p className="sub">
          Audio or video → text via OpenAI Whisper (runs only on your machine;
          API key stays in <code>server/.env</code>).
        </p>
      </header>

      <section className="transcribe-section" aria-label="Transcription source">
        <div className="input-mode-tabs" role="tablist" aria-label="Input mode">
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === 'file'}
            className={`input-mode-tab ${inputMode === 'file' ? 'input-mode-tab-active' : ''}`}
            onClick={() => switchMode('file')}
          >
            Choose file
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === 'record'}
            className={`input-mode-tab ${inputMode === 'record' ? 'input-mode-tab-active' : ''}`}
            onClick={() => switchMode('record')}
          >
            Record
          </button>
        </div>

        {inputMode === 'file' ? (
          <div
            className={`drop ${dragActive ? 'drop-active' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragActive(false)
              onFiles(e.dataTransfer.files)
            }}
          >
            <label className="file-label">
              <span className="file-label-text">Choose file</span>
              <input
                type="file"
                accept="audio/*,video/*,.mp3,.wav,.m4a,.webm,.mp4,.mov,.mkv"
                className="file-input"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            <p className="hint">or drag and drop here</p>
          </div>
        ) : (
          <div className="record-panel">
            <div className="record-actions">
              <button
                type="button"
                className={`record-toggle ${isRecording ? 'record-toggle-active' : ''}`}
                disabled={loading}
                onClick={() => (isRecording ? stopRecording() : void startRecording())}
              >
                {isRecording ? 'Stop recording' : 'Start recording'}
              </button>
              {isRecording && (
                <span className="record-timer" aria-live="polite">
                  {formatRecordTime(recordingSeconds)}
                </span>
              )}
            </div>
            <p className="hint">
              Allow microphone access when prompted. Stop when you are done, then use Transcribe below.
            </p>
          </div>
        )}

        {file && (
          <p className="file-name">
            Selected: <strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </section>

      <div className="actions">
        <button type="button" disabled={!file || loading || isRecording} onClick={transcribe}>
          {loading ? 'Transcribing…' : 'Transcribe'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <label className="out-label" htmlFor="out">
        Transcript
      </label>
      <textarea
        id="out"
        className="out"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Transcript appears here…"
      />

      <div className="actions secondary">
        <button type="button" disabled={!text || loading} onClick={copy}>
          {copied ? 'Copied' : 'Copy transcript'}
        </button>
      </div>

      <label className="out-label" htmlFor="dictation">
        Dictation (text to speech)
      </label>
      <textarea
        id="dictation"
        className="out dictation-input"
        value={dictationInput}
        onChange={(e) => setDictationInput(e.target.value)}
        placeholder="Type text to convert into spoken audio..."
      />

      <div className="actions">
        <button type="button" disabled={!dictationInput.trim() || generatingAudio} onClick={dictate}>
          {generatingAudio ? 'Generating audio…' : 'Generate audio'}
        </button>
        <button type="button" disabled={!audioBlob || generatingAudio} onClick={downloadAudio}>
          Download MP3
        </button>
      </div>

      {audioUrl && (
        <div className="audio-wrap">
          <audio controls src={audioUrl} className="audio-player">
            Your browser does not support audio playback.
          </audio>
        </div>
      )}
    </div>
  )
}
