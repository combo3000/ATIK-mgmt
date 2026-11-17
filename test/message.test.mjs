// Run: npm test   (Claude is replaced by a local mock server)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import handler, { validateBody, draftMessage } from "../api/partner-message.js";

test("message validateBody: needs point and a known purpose", () => {
  assert.throws(() => validateBody({ purposes: ["report"] }), /точку/);
  assert.throws(() => validateBody({ point: { name: "Кімера" }, purposes: ["hack"] }), /Оберіть/);
  const v = validateBody({ point: { name: "Кімера" }, purposes: ["report", "x"], facts: { debt: 100 }, examples: "Привіт!" });
  assert.ok(v.json.includes('"purposes":["report"]'));
  assert.equal(v.examples, "Привіт!");
});

test("draftMessage: sends facts and style examples, returns text", async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    let d = ""; req.on("data", (c) => (d += c));
    req.on("end", () => {
      seen = JSON.parse(d);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify({ text: " Привіт, Олено! " }) }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const client = new Anthropic({ apiKey: "t", baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const out = await draftMessage(validateBody({ point: { name: "Кімера", contactName: "Олена" }, purposes: ["payment"], facts: { debt: 1100 }, examples: "Привіт, сонце" }), client);
    assert.equal(out.text, "Привіт, Олено!");
    const t = seen.messages[0].content[0].text;
    assert.ok(t.includes('"debt":1100') && t.includes("Привіт, сонце"));
    assert.equal(seen.output_config.effort, "low");
  } finally { server.close(); }
});

test("message handler: 405", async () => {
  const res = { statusCode: 0, status(c) { this.statusCode = c; return this; }, setHeader() {}, end() {} };
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test("draftMessage: customer audience uses the customer prompt", async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    let d = ""; req.on("data", (c) => (d += c));
    req.on("end", () => {
      seen = JSON.parse(d);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify({ text: "Ірино, добрий день!" }) }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const client = new Anthropic({ apiKey: "t", baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const v = validateBody({ audience: "customer", point: { name: "Ірина" }, purposes: ["repeat"], facts: { favorite: ["Cherry Bloom"] } });
    const out = await draftMessage(v, client);
    assert.equal(out.text, "Ірино, добрий день!");
    assert.match(seen.system, /покупцеві/);
    assert.ok(seen.messages[0].content[0].text.startsWith("Дані про покупця"));
  } finally { server.close(); }
});
