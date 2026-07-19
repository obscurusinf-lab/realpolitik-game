import React, { useState, useRef, useEffect } from "react";
import { submitFeedback } from "./api";

// Максимум записи (2026-07-19, Петя: "добавь возможность записать аудиосообщение" — игроку
// проще наговорить баг, чем сформулировать текстом). Ограничение по времени, а не только по
// размеру base64 на бэкенде (feedback.js, MAX_AUDIO_BASE64_LEN) — так пользователь видит понятный
// лимит ("до 2 минут"), а не узнаёт про превышение только после попытки отправки.
const MAX_RECORD_SECONDS = 120;

// Первый поддерживаемый браузером формат из списка — Chrome/Firefox берут webm/opus (компактный,
// хорошее качество на голосе), Safari его не умеет и попадает в mp4 либо в дефолт без mimeType.
function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

function formatSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function FeedbackModal({ onClose, gameId }) {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [micError, setMicError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  // Чистим микрофон/таймер при закрытии модалки, не только при явной остановке записи — иначе
  // индикатор записи в браузере (красная точка на вкладке) остаётся висеть после закрытия формы.
  useEffect(() => () => { clearInterval(timerRef.current); stopStream(); }, []);

  async function startRecording() {
    setMicError(null);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stopStream();
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= MAX_RECORD_SECONDS) { stopRecording(); return MAX_RECORD_SECONDS; }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      // NotAllowedError (запрет доступа) — самый частый случай, остальное (нет микрофона и т.п.)
      // тоже сводим к одному понятному сообщению, техническую причину не показываем.
      setMicError("Не удалось получить доступ к микрофону — проверьте разрешение в браузере.");
    }
  }

  function stopRecording() {
    clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  function discardRecording() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordSeconds(0);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // data:audio/webm;base64,XXXX — бэкенду нужна только часть после запятой, mime уже
        // передаётся отдельным полем (audioBlob.type).
        const base64 = String(reader.result).split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function handleSend() {
    // Голосовое само по себе — валидный репорт (не всем удобно ещё и печатать) — текст обязателен
    // только на бэкенде (feedback_items.message NOT NULL), поэтому при пустом поле и наличии
    // аудио подставляем понятную заглушку вместо требования что-то напечатать.
    const trimmed = message.trim();
    if (!trimmed && !audioBlob) {
      setError("Опишите проблему текстом или запишите голосовое сообщение");
      return;
    }
    setSending(true); setError(null);
    try {
      let audio = null;
      if (audioBlob) {
        const base64 = await blobToBase64(audioBlob);
        audio = { base64, mime: audioBlob.type || "audio/webm" };
      }
      await submitFeedback(trimmed || "🎤 Голосовое сообщение (см. вложение)", contact.trim(), gameId, audio);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const inputStyle = {
    width: "100%", background: "#ece7d8", color: "#262420",
    border: "2px solid #3a4156", borderRadius: 4,
    padding: "11px 14px", fontFamily: "'PT Serif',serif", fontSize: 14,
    outline: "none", marginBottom: 10,
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,16,0.85)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#1f2733", border: "1px solid #2a3040", borderRadius: 6, width: "min(95vw,440px)", padding: "20px 22px" }}>
        {sent ? (
          <>
            <div className="doc-font" style={{ fontSize: 16, color: "#9c8347", fontWeight: 700, marginBottom: 8 }}>Спасибо!</div>
            <div className="doc-font" style={{ fontSize: 13, color: "#a8a294", lineHeight: 1.5, marginBottom: 16 }}>Сообщение отправлено. Это игра в альфа-версии — каждый репорт реально помогает.</div>
            <button onClick={onClose} style={{ width: "100%", background: "#9c8347", color: "#1a1f2c", border: "none", borderRadius: 4, padding: "10px", fontFamily: "'PT Serif',serif", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Закрыть</button>
          </>
        ) : (
          <>
            <div className="doc-font" style={{ fontSize: 16, color: "#ece7d8", fontWeight: 700, marginBottom: 4 }}>🐞 Сообщить о баге</div>
            <div className="doc-font" style={{ fontSize: 12, color: "#5a6070", lineHeight: 1.5, marginBottom: 14 }}>Опишите, что пошло не так — и по возможности, что вы делали перед этим. Или просто наговорите голосом.</div>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Например: нажал «Погасить ОФЗ», казна не изменилась…"
              rows={5} maxLength={4000} style={{ ...inputStyle, resize: "vertical", fontFamily: "'PT Serif',serif" }} />

            <div style={{ marginBottom: 10 }}>
              {!audioBlob && !recording && (
                <button onClick={startRecording} type="button"
                  style={{ display: "flex", alignItems: "center", gap: 7, background: "#2a3040", border: "1px solid #3a4156", borderRadius: 4, color: "#ece7d8", padding: "8px 14px", fontFamily: "'PT Serif',serif", fontSize: 13, cursor: "pointer" }}>
                  🎤 Записать голосовое сообщение
                </button>
              )}
              {recording && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#2a1414", border: "1px solid #a8313a", borderRadius: 4, padding: "8px 14px" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#e06060", flexShrink: 0, animation: "rp-rec-pulse 1.2s infinite" }} />
                  <span className="mono-font" style={{ fontSize: 12, color: "#e09090", flex: 1 }}>Идёт запись… {formatSeconds(recordSeconds)} / {formatSeconds(MAX_RECORD_SECONDS)}</span>
                  <button onClick={stopRecording} type="button"
                    style={{ background: "#a8313a", border: "none", borderRadius: 4, color: "#fff", padding: "5px 12px", fontFamily: "'PT Serif',serif", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                    ⏹ Стоп
                  </button>
                </div>
              )}
              {audioBlob && !recording && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#141a24", border: "1px solid #2a3040", borderRadius: 4, padding: "8px 10px" }}>
                  <audio controls src={audioUrl} style={{ flex: 1, height: 32 }} />
                  <button onClick={discardRecording} type="button" title="Удалить запись"
                    style={{ background: "none", border: "1px solid #3a4156", borderRadius: 4, color: "#e09090", padding: "5px 9px", fontSize: 12, cursor: "pointer" }}>
                    🗑
                  </button>
                </div>
              )}
              {micError && <div className="doc-font" style={{ color: "#e09090", fontSize: 12, marginTop: 6 }}>{micError}</div>}
            </div>

            <input value={contact} onChange={e => setContact(e.target.value)}
              placeholder="Контакт для ответа (необязательно)" style={inputStyle} />
            {error && <div className="doc-font" style={{ color: "#e09090", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSend} disabled={sending}
                style={{ flex: 1, background: sending ? "#2a3040" : "#9c8347", color: sending ? "#5a6070" : "#1a1f2c", border: "none", borderRadius: 4, padding: "10px", fontFamily: "'PT Serif',serif", fontSize: 14, fontWeight: 700, cursor: sending ? "not-allowed" : "pointer" }}>
                {sending ? "Отправка…" : "Отправить"}
              </button>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #2a3040", borderRadius: 4, color: "#5a6070", padding: "10px 16px", fontFamily: "'PT Serif',serif", fontSize: 14, cursor: "pointer" }}>Отмена</button>
            </div>
          </>
        )}
      </div>
      <style>{`
        @keyframes rp-rec-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
