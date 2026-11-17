// Run: npm test   (Claude is replaced by a local mock server)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import handler, { validateBody, normalizeResult, weeklyReport } from "../api/weekly-report.js";

test("weekly validateBody: needs data, caps size", () => {
  assert.throws(() => validateBody({}), /Немає даних/);
  assert.throws(() => validateBody({ data: { x: "a".repeat(70000) } }), /Забагато/);
  assert.ok(validateBody({ data: { goal: { done: 1 } } }).json.includes("done"));
});

test("weekly normalizeResult: sorts by priority, drops empty", () => {
  const out = normalizeResult({ headline: "h", summary: "s", actions: [
    { priority: "low", title: "c", details: "", partner: "" },
    { priority: "high", title: "a", details: "d", partner: "Кімера" },
    { priority: "weird", title: "b", details: "", partner: "" },
    { priority: "high", title: "", details: "", partner: "" },
  ] });
  assert.deepEqual(out.actions.map((a) => a.title), ["a", "b", "c"]);
  assert.equal(out.actions[1].priority, "medium");
});

test("weeklyReport: sends data to Claude with schema, parses answer", async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    let data = ""; req.on("data", (c) => (data += c));
    req.on("end", () => {
      seen = JSON.parse(data);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: "text", text: JSON.stringify({ headline: "45% цілі", summary: "ok", actions: [{ priority: "high", title: "Попросити звіт", details: "", partner: "Кімера" }] }) }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const client = new Anthropic({ apiKey: "t", baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const out = await weeklyReport(validateBody({ data: { goal: { pct: 45 } } }), client);
    assert.equal(out.headline, "45% цілі");
    assert.equal(out.actions[0].partner, "Кімера");
    assert.deepEqual(seen.output_config.format.schema.required, ["headline", "summary", "actions"]);
    assert.ok(seen.messages[0].content[0].text.includes('"pct":45'));
  } finally { server.close(); }
});

test("weekly handler: 405 / auth", async () => {
  const res = { statusCode: 0, headers: {}, status(c) { this.statusCode = c; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  process.env.ALLOWED_EMAILS = "a@b.c";
  await handler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
});
