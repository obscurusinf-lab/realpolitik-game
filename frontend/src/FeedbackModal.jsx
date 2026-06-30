import React, { useState } from "react";
import { submitFeedback } from "./api";

export function FeedbackModal({ onClose, gameId }) {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    if (!message.trim()) { setError("Опишите проблему хотя бы в двух словах"); return; }
    setSending(true); setError(null);
    try {
      await submitFeedback(message.trim(), contact.trim(), gameId);
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
            <div className="doc-font" style={{ fontSize: 12, color: "#5a6070", lineHeight: 1.5, marginBottom: 14 }}>Опишите, что пошло не так — и по возможности, что вы делали перед этим.</div>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Например: нажал «Погасить ОФЗ», казна не изменилась…"
              rows={5} maxLength={4000} style={{ ...inputStyle, resize: "vertical", fontFamily: "'PT Serif',serif" }} />
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
    </div>
  );
}
