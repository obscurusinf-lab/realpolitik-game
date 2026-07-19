-- Аудиосообщение к баг-репорту (2026-07-19, Петя: игроку неудобно/долго формулировать проблему
-- текстом — дать возможность просто наговорить). Храним как base64 прямо в TEXT-колонке (не
-- отдельное object storage — сообщения короткие и редкие, инфраструктуры под blob-хранилище в
-- проекте пока нет), MIME отдельно для корректного воспроизведения на бэкенде/в админке.

ALTER TABLE feedback_items ADD COLUMN IF NOT EXISTS audio_data TEXT;
ALTER TABLE feedback_items ADD COLUMN IF NOT EXISTS audio_mime TEXT;
