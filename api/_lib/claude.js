// Shared Claude settings and a structured-output call used by the AI endpoints.
import { httpError } from "./http.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

// One Claude call that must answer with JSON matching `schema`.
// `client` is an Anthropic client (injected so tests can point it at a mock server).
export async function claudeJson(client, { system, content, schema, maxTokens = 16000, effort = "medium" }) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: "json_schema", schema } },
    // If a safety classifier declines, the API retries on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw httpError(422, "AI відмовився обробити ці дані");
  if (response.stop_reason === "max_tokens") throw httpError(422, "Забагато даних, AI не встиг відповісти");
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw httpError(502, "AI не повернув результату");
  let parsed;
  try { parsed = JSON.parse(textBlock.text); } catch { throw httpError(502, "AI повернув некоректні дані"); }
  return {
    parsed,
    usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0, model: response.model },
  };
}

// Maps errors to HTTP responses the same way for every endpoint.
export function sendError(res, e, Anthropic, sendJson) {
  if (e instanceof Anthropic.APIError) {
    const status = e.status === 429 ? 429 : 502;
    console.error("Anthropic API error", e.status, e.message);
    return sendJson(res, status, { error: e.status === 429 ? "AI перевантажений, спробуйте за хвилину" : "Помилка AI-сервісу" });
  }
  if (e && e.status) return sendJson(res, e.status, { error: e.message });
  if (e instanceof SyntaxError) return sendJson(res, 400, { error: "Некоректний JSON" });
  console.error(e);
  return sendJson(res, 500, { error: "Внутрішня помилка сервера" });
}
