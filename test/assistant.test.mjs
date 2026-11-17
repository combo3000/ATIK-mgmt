// Run: npm test   (Claude is replaced by a local mock server)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import handler, { validateBody, assistantStep } from "../api/assistant.js";
import { TOOLS, ACTION_TOOLS } from "../api/_lib/assistant-tools.js";

test("assistant tools: unique names, action tools only propose", () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(ACTION_TOOLS.every((t) => t.name.startsWith("propose_")));
  assert.ok(TOOLS.every((t) => t.input_schema && t.input_schema.type === "object"));
});

test("assistant validateBody: roles, block filter, starts with user, size cap", () => {
  assert.throws(() => validateBody({}), /Немає повідомлень/);
  assert.throws(() => validateBody({ messages: [{ role: "system", content: "x" }] }), /Некоректне/);
  const v = validateBody({ today: "2026-11-17", messages: [
    { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "{}" }] },
    { role: "user", content: [{ type: "text", text: "Скільки продали?" }, { type: "image", source: {} }] },
  ] });
  assert.equal(v.messages.length, 1);
  assert.deepEqual(v.messages[0].content.map((b) => b.type), ["text"]);
  assert.equal(v.today, "2026-11-17");
  assert.throws(() => validateBody({ messages: [{ role: "user", content: [{ type: "text", text: "a".repeat(400000) }] }] }), /задовга/);
});

test("assistantStep: sends tools + system, drops unknown tool calls", async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    let d = ""; req.on("data", (c) => (d += c));
    req.on("end", () => {
      seen = JSON.parse(d);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 9, output_tokens: 3 }, content: [
          { type: "text", text: "Дивлюсь" },
          { type: "tool_use", id: "t1", name: "list_points", input: {} },
          { type: "tool_use", id: "t2", name: "delete_everything", input: {} },
        ] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const client = new Anthropic({ apiKey: "t", baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const out = await assistantStep(validateBody({ today: "2026-11-17", messages: [{ role: "user", content: "Хто винен гроші?" }] }), client);
    assert.equal(out.stop_reason, "tool_use");
    assert.deepEqual(out.content.map((b) => b.name || b.type), ["text", "list_points"]);
    assert.equal(seen.tools.length, TOOLS.length);
    assert.match(seen.system, /2026-11-17/);
    assert.match(seen.system, /нічого не зберігаєш/);
  } finally { server.close(); }
});

test("assistant handler: 405 / auth", async () => {
  const mk = () => ({ statusCode: 0, body: "", status(c) { this.statusCode = c; return this; }, setHeader() {}, end(b) { this.body = b; } });
  const r1 = mk(); await handler({ method: "GET", headers: {} }, r1); assert.equal(r1.statusCode, 405);
  const r2 = mk(); await handler({ method: "POST", headers: {}, body: {} }, r2); assert.ok([401, 503].includes(r2.statusCode));
});

test("document draft tools are offered and propose_document needs exact items", () => {
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes("list_products"));
  assert.ok(names.includes("propose_document"));
  const pd = TOOLS.find((t) => t.name === "propose_document");
  assert.deepEqual(pd.input_schema.required.slice().sort(), ["doc_type", "items", "point"]);
});
