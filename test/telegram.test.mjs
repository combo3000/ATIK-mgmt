// Telegram bot and Monday report: app code running on the server, the assistant loop, access control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppRuntime, appLink, APP_URL } from "../api/_lib/app-runtime.js";
import { decodeFields, encodeValue } from "../api/_lib/firestore.js";
import { runAssistant, processUpdate, toTelegramHtml, splitMessage } from "../api/telegram.js";
import { reportText } from "../api/telegram-weekly.js";

const plain = (x) => JSON.parse(JSON.stringify(x));
const buyer = { id: "b1", name: "ФОП Тестова", retailName: "Тестова Точка", isRetail: true, dealType: "prepay" };
const state = { buyers: [buyer], journal: [], salesReports: [], retailStock: {} };

function fakeClient(steps) {
  const calls = [];
  return { calls, beta: { messages: { create: async (req) => { calls.push(plain(req)); const s = steps[Math.min(calls.length - 1, steps.length - 1)]; return { stop_reason: s.stop, content: s.content, usage: {}, model: "m" }; } } } };
}

test("app code runs on the server with the shared data", () => {
  const rt = createAppRuntime(state);
  const lp = rt.runTool("list_products", { query: "чорний сандал" });
  assert.ok(lp.count >= 1);
  const pid = lp.products.find((p) => /40/.test(p.pack)).id;
  const doc = rt.runTool("propose_document", { point: "Тестова", doc_type: "bill", items: [{ product_id: pid, qty: 10 }] });
  assert.equal(doc.action.link.do, "doc");
  assert.equal(doc.action.link.l, pid + ":10");
  const url = appLink(doc.action.link);
  assert.ok(url.startsWith(APP_URL + "?do=doc&b=b1&t=bill&l="));
  assert.ok(rt.runTool("get_overview", {}).goal);
  assert.match(rt.today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(rt.runTool("propose_document", { point: "Тестова", doc_type: "bill", items: [{ product_id: "nope", qty: 1 }] }).error);
  const wk = rt.weeklyData();
  assert.ok(reportText(wk, { headline: "Тиждень", summary: "Ок", actions: [{ priority: "high", title: "Нагадати", partner: "Тестова Точка", details: "" }] }).includes("Що зробити"));
});

test("assistant loop runs tools and turns proposals into app buttons", async () => {
  const rt = createAppRuntime(state);
  const client = fakeClient([
    { stop: "tool_use", content: [{ type: "tool_use", id: "t1", name: "list_products", input: { query: "blacksandal40" } }] },
    { stop: "tool_use", content: [{ type: "text", text: "Готово, **рахунок** нижче." }, { type: "tool_use", id: "t2", name: "propose_document", input: { point: "Тестова", doc_type: "bill", items: [{ product_id: "blacksandal40", qty: 10 }] } }] },
  ]);
  const r = await runAssistant({ history: [], text: "рахунок", runtime: rt, client, today: "2026-11-18" });
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls[0].system.includes("Telegram"));
  assert.equal(client.calls[1].messages[2].content[0].type, "tool_result");
  assert.equal(r.answer, "Готово, **рахунок** нижче.");
  assert.equal(r.actions.length, 1);
  assert.match(r.actions[0].url, /do=doc&b=b1&t=bill&l=blacksandal40%3A10/);
});

test("strangers get only their ID; allowed users get answers and a session", async () => {
  process.env.TELEGRAM_ALLOWED_IDS = "111, 222";
  const sent = [], saved = {};
  const db = { getDoc: async (p) => (p === "shared/main" ? { state } : saved[p] || null), setDoc: async (p, v) => { saved[p] = plain(v); }, listDocs: async () => [] };
  const sendText = async (chat, text, buttons = []) => sent.push({ chat, text, buttons });
  await processUpdate({ message: { chat: { id: 9, type: "private" }, from: { id: 999 }, text: "борги?" } }, { sendText, db, client: fakeClient([]) });
  assert.match(sent[0].text, /Ваш Telegram ID: 999/);
  assert.equal(Object.keys(saved).length, 0);
  await processUpdate({ message: { chat: { id: 5, type: "group" }, from: { id: 111 }, text: "x" } }, { sendText, db });
  assert.equal(sent.length, 1, "groups are ignored");
  const client = fakeClient([{ stop: "end_turn", content: [{ type: "text", text: "Боргів немає." }] }]);
  await processUpdate({ message: { chat: { id: 111, type: "private" }, from: { id: 111 }, text: "борги?" } }, { sendText, db, client });
  assert.equal(sent[1].text, "Боргів немає.");
  assert.deepEqual(saved["tg_sessions/111"].messages.map((m) => m.role), ["user", "assistant"]);
  // Follow-up question carries the earlier turn
  await processUpdate({ message: { chat: { id: 111, type: "private" }, from: { id: 111 }, text: "а в жовтні?" } }, { sendText, db, client });
  assert.equal(client.calls[1].messages.length, 3);
});

test("Telegram formatting is escaped and split", () => {
  assert.equal(toTelegramHtml("**Кімера** <b>&\n- пункт"), "<b>Кімера</b> &lt;b&gt;&amp;\n• пункт");
  const parts = splitMessage("a".repeat(5000) + "\n\n" + "b".repeat(100));
  assert.ok(parts.every((p) => p.length <= 3900));
  assert.equal(parts.join("").replace(/\n/g, "").length, 5100);
});

test("Firestore values decode and encode", () => {
  const f = encodeValue({ a: 1, b: 1.5, c: "x", d: [true, null], e: { f: "g" } }).mapValue.fields;
  assert.deepEqual(decodeFields(f), { a: 1, b: 1.5, c: "x", d: [true, null], e: { f: "g" } });
});
