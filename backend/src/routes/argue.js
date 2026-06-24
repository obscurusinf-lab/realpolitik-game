/**
 * argue.js
 *
 * POST /games/:gameId/turns/argue
 * Игрок отвечает на возражение советника. Claude решает:
 *   withdrawn: true  — советник принял аргумент, возражение снято
 *   withdrawn: false — советник настаивает, приводит контраргумент
 *
 * Pending-ход в Redis при withdrawn=true обновляется (advisor_objection = null),
 * чтобы confirm записал в БД уже без возражения.
 */

async function registerArgueRoute(fastify, { db, callClaudeApi, pendingTurnStore }) {
  fastify.post("/games/:gameId/turns/argue", async (request, reply) => {
    const { gameId } = request.params;
    const { playerArgument } = request.body || {};

    if (!playerArgument?.trim()) {
      return reply.code(400).send({ error: "playerArgument is required" });
    }

    const pending = await pendingTurnStore.get(gameId);
    if (!pending) {
      return reply.code(409).send({ error: "No pending turn. Call /turns/preview first." });
    }

    const objection = pending.gmClassification?.advisor_objection;
    if (!objection) {
      return reply.send({ withdrawn: true, advisorResponse: "Возражений не было." });
    }

    const gameRes = await db.query(
      `SELECT c.name AS country_name FROM games g JOIN countries c ON c.id = g.country_id WHERE g.id = $1`,
      [gameId]
    );
    const countryName = gameRes.rows[0]?.country_name || "страна";

    const prompt = buildArguePrompt({
      countryName,
      narrative: pending.gmClassification.narrative,
      objection,
      playerArgument: playerArgument.trim(),
    });

    const response = await callClaudeApi({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json\s*|\s*```/g, "").trim());
    } catch {
      return reply.send({ withdrawn: false, advisorResponse: "Советник выслушал вас, но остался при своём мнении." });
    }

    // Если советник отступил — убираем возражение из pending в Redis
    if (parsed.withdrawn) {
      const updated = { ...pending };
      updated.gmClassification = { ...updated.gmClassification, advisor_objection: null };
      await pendingTurnStore.save(gameId, updated);
    }

    return reply.send({
      withdrawn: !!parsed.withdrawn,
      advisorResponse: parsed.advisor_response || "Советник принял ваши аргументы.",
    });
  });
}

function buildArguePrompt({ countryName, narrative, objection, playerArgument }) {
  return `Ты — советник президента ${countryName} в геополитической стратегии. Ты только что выразил возражение против решения президента, и теперь президент тебе отвечает.

РЕШЕНИЕ ПРЕЗИДЕНТА (нарратив): "${narrative}"

ТВОЁ ВОЗРАЖЕНИЕ: "${objection}"

ОТВЕТ ПРЕЗИДЕНТА: "${playerArgument}"

Оцени аргумент президента и реши: принять его или настаивать на своём.

Критерии:
- Если аргумент логичен, содержит конкретные обоснования или новую информацию — прими, withdrawn: true
- Если аргумент слабый, эмоциональный или просто приказной ("я так решил") — настаивай, withdrawn: false
- Отвечай живым разговорным языком, 2-3 предложения, в роли конкретного советника

Верни ТОЛЬКО JSON без markdown:
{"withdrawn": true/false, "advisor_response": "ответ советника"}`;
}

module.exports = { registerArgueRoute };
