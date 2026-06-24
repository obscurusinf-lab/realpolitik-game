/**
 * claude-client.js
 *
 * Реальная обёртка для вызова Claude API через @anthropic-ai/sdk.
 * Используется как callClaudeApi в server.js — в тестах заменяется моком.
 */

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Совместимый интерфейс: принимает { model, max_tokens, messages }
 * и возвращает объект с полем content (массив блоков, как у Anthropic).
 */
async function callClaudeApi({ model, max_tokens, messages }) {
  const response = await client.messages.create({ model, max_tokens, messages });
  return response;
}

module.exports = { callClaudeApi };
