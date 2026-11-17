// Run: npm test   (no network, no API key: Claude is replaced by a local mock server)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import handler, { validateBody, normalizeResult, parseReport } from "../api/parse-sales-report.js";
import health from "../api/health.js";

const shelf = [
  { productId: "cherry20", name: "Cherry Bloom 20шт", qty: 6 },
  { productId: "cherry40", name: "Cherry Bloom 40шт", qty: 2 },
  { productId: "osmanthus20", name: "Osmanthus 20шт", qty: 4 },
];

function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: "" };
  r.status = (c) => { r.statusCode = c; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.end = (b) => { r.body = b || ""; return r; };
  r.json = () => JSON.parse(r.body);
  return r;
}

test("validateBody: keeps shelf ids, rejects empty input", () => {
  const v = validateBody({ pointName: "Кімера", shelf, report: { type: "text", text: "вишня 20 - 3" } });
  assert.deepEqual(v.ids, ["cherry20", "cherry40", "osmanthus20"]);
  assert.throws(() => validateBody({ shelf: [], report: { type: "text", text: "x" } }), /полиці/);
  assert.throws(() => validateBody({ shelf, report: { type: "text", text: "  " } }), /порожній/);
  assert.throws(() => validateBody({ shelf, report: { type: "image", mediaType: "application/pdf", data: "x" } }), /формат/);
});

test("normalizeResult: merges duplicates, drops zeros/unknown ids, flags over-shelf", () => {
  const out = normalizeResult({
    items: [
      { productId: "cherry20", reportedName: "вишня", sold: 2, confidence: "high" },
      { productId: "cherry20", reportedName: "вишня мала", sold: 5, confidence: "low" },
      { productId: "osmanthus20", reportedName: "осм", sold: 0, confidence: "high" },
      { productId: "nope", reportedName: "x", sold: 1, confidence: "high" },
    ],
    unmatched: [{ reportedName: "свічка", sold: 1 }],
    reportPeriod: "жовтень 2026",
    notes: "",
  }, shelf);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].sold, 7);
  assert.equal(out.items[0].confidence, "low");
  assert.equal(out.items[0].overShelf, true);
  assert.equal(out.unmatched[0].reportedName, "свічка");
});

test("parseReport: sends schema with shelf ids + fallbacks, parses the answer", async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      seen = { url: req.url, headers: req.headers, body: JSON.parse(data) };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5",
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 120 },
        content: [{ type: "text", text: JSON.stringify({
          items: [{ productId: "cherry40", reportedName: "Cherry big", sold: 1, confidence: "high" }],
          unmatched: [], reportPeriod: "жовтень", notes: "",
        }) }],
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const client = new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 });
    const input = validateBody({ pointName: "Кімера", shelf, report: { type: "text", text: "Cherry big 1" } });
    const out = await parseReport(input, client);
    assert.deepEqual(out.items.map((i) => [i.productId, i.sold]), [["cherry40", 1]]);
    assert.equal(out.usage.input_tokens, 900);
    assert.match(seen.url, /\/v1\/messages/);
    assert.match(String(seen.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    assert.equal(seen.body.model, "claude-sonnet-5-5");
    assert.equal(seen.body.fallbacks, "default");
    assert.deepEqual(seen.body.output_config.format.schema.properties.items.items.properties.productId.enum, ["cherry20", "cherry40", "osmanthus20"]);
    assert.ok(seen.body.messages[0].content[0].text.includes("Cherry big 1"));
  } finally {
    server.close();
  }
});

test("handler: refuses without config / sign-in", async () => {
  const req = { method: "POST", headers: {}, body: {} };
  delete process.env.ALLOWED_EMAILS;
  let res = fakeRes(); await handler(req, res);
  assert.equal(res.statusCode, 503);
  process.env.ALLOWED_EMAILS = "owner@example.com";
  res = fakeRes(); await handler(req, res);
  assert.equal(res.statusCode, 401);
  res = fakeRes(); await handler({ ...req, headers: { authorization: "Bearer not-a-jwt" } }, res);
  assert.equal(res.statusCode, 401);
  res = fakeRes(); await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test("CORS: GitHub Pages origin allowed, others not; preflight 204", async () => {
  let res = fakeRes();
  await handler({ method: "OPTIONS", headers: { origin: "https://combo3000.github.io" } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://combo3000.github.io");
  res = fakeRes();
  await handler({ method: "OPTIONS", headers: { origin: "https://evil.example" } }, res);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("health: reports config presence only", () => {
  process.env.ANTHROPIC_API_KEY = "sk-secret";
  const res = fakeRes(); health({ method: "GET", headers: {} }, res);
  const j = res.json();
  assert.equal(j.anthropicKey, true);
  assert.ok(!res.body.includes("sk-secret"));
  delete process.env.ANTHROPIC_API_KEY;
});
