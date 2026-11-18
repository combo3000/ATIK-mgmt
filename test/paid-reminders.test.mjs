// Bot: marking documents paid (only on button press, exact write) and personal reminders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeValue, decodeFields } from "../api/_lib/firestore.js";
import { payFields, markPaid } from "../api/_lib/mark-paid.js";
import { kyivToDate, saveReminder, deliverDue } from "../api/_lib/user-reminders.js";
import { createAppRuntime } from "../api/_lib/app-runtime.js";
import { runAssistant, processCallback } from "../api/telegram.js";

const bill = { id: "d1", docType: "bill", invoiceNum: "233", total: 6685, status: "created", buyerId: "x" };
const other = { id: "d2", docType: "bill", invoiceNum: "237", total: 100, status: "created", items: [{ id: "p", qty: 1, price: 100.5 }] };

test("payFields adds one payment for the outstanding amount", () => {
  const r = payFields(bill, { who: "Настя", date: "2026-11-18", now: new Date(0) });
  assert.equal(r.amount, 6685);
  assert.equal(r.status, "paid");
  assert.equal(r.payments.length, 1);
  assert.match(r.payments[0].note, /Telegram \(Настя\)/);
  assert.equal(payFields({ ...bill, payments: [{ amount: 6685 }] }).already, true);
  assert.equal(payFields({ ...bill, status: "paid" }).already, true, "legacy paid");
  const part = payFields({ ...bill, payments: [{ amount: 685 }] });
  assert.equal(part.amount, 6000);
  const inv = payFields({ ...bill, docType: "invoice", status: "shipped" });
  assert.equal(inv.status, "shipped", "накладна keeps shipping status");
});

test("markPaid changes only that document and writes with a precondition", async () => {
  const stateFields = encodeValue({ journal: [bill, other], buyers: [{ id: "x", name: "Le_treat" }] }).mapValue.fields;
  const raw = { updateTime: "T1", fields: { state: { mapValue: { fields: stateFields } }, revision: { stringValue: "rev_old" }, schema: { integerValue: "3" } } };
  const writes = [];
  let first = true;
  const deps = { getRaw: async () => raw, commit: async (w) => { if (first) { first = false; throw Object.assign(new Error("x"), { conflict: true }); } writes.push(w[0]); } };
  const r = await markPaid("d1", { who: "Настя", deps });
  assert.equal(r.ok, true);
  assert.equal(r.label, "Рахунок №233");
  const w = writes[0];
  assert.equal(w.currentDocument.updateTime, "T1");
  assert.deepEqual(w.updateMask.fieldPaths.sort(), ["prevRevision", "revision", "schema", "state", "updatedBy"]);
  const st = decodeFields(w.update.fields.state.mapValue.fields);
  assert.equal(st.journal[0].status, "paid");
  assert.equal(st.journal[0].payments[0].amount, 6685);
  assert.deepEqual(st.journal[1], other, "other documents untouched");
  assert.deepEqual(w.update.fields.state.mapValue.fields.journal.arrayValue.values[1], stateFields.journal.arrayValue.values[1], "raw bytes kept");
  assert.equal(w.update.fields.prevRevision.stringValue, "rev_old");
  assert.equal((await markPaid("nope", { deps })).reason, "not_found");
});

test("Kyiv time → UTC, reminder validation and one-time delivery", async () => {
  assert.equal(kyivToDate("2026-11-19T10:00").toISOString(), "2026-11-19T08:00:00.000Z");
  assert.equal(kyivToDate("2026-07-01T10:00").toISOString(), "2026-07-01T07:00:00.000Z");
  assert.equal(kyivToDate("2026-11-19").toISOString(), "2026-11-19T08:00:00.000Z", "date only → 10:00");
  const saved = [];
  const setDoc = async (p, v) => saved.push([p, v]);
  assert.match((await saveReminder({ chatId: 1, when: "2020-01-01T10:00", text: "x" }, { setDoc })).error, /минув/);
  assert.match((await saveReminder({ chatId: 1, when: "завтра", text: "x" }, { setDoc })).error, /Не зрозумів/);
  const next = new Date(Date.now() + 86400000);
  const when = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(next) + "T10:00";
  const ok = await saveReminder({ chatId: 42, when, text: "рахунок №237" }, { setDoc });
  assert.equal(ok.ok, true);
  assert.match(saved[0][0], /^tg_reminders\/42_/);
  const store = [{ _id: "a", chatId: "42", at: new Date(Date.now() - 1000).toISOString(), text: "№237" }, { _id: "b", chatId: "42", at: next.toISOString(), text: "later" }];
  const deleted = new Set(), sent = [];
  const deps = { listDocs: async () => store, deleteDoc: async (p) => { if (deleted.has(p)) return false; deleted.add(p); return true; } };
  assert.equal(await deliverDue(async (c, t) => sent.push([c, t]), deps), 1);
  assert.equal(await deliverDue(async (c, t) => sent.push([c, t]), deps), 0, "never twice");
  assert.deepEqual(sent, [["42", "⏰ **Нагадування:** №237"]]);
});

test("assistant: paid → confirm button (callback), reminder stored via set_reminder", async () => {
  const rt = createAppRuntime({ buyers: [{ id: "x", name: "Le_treat", isRetail: true }], journal: [bill, other] });
  const out = rt.runTool("propose_mark_paid", { doc_number: "№233" });
  assert.deepEqual(out.action.pay, { doc: "d1" });
  assert.match(out.action.label, /№233 · Le_treat · 6\s?685 ₴/);
  assert.ok(rt.runTool("propose_mark_paid", { doc_number: "999" }).error);
  const calls = [];
  const client = { beta: { messages: { create: async (req) => { calls.push(req); return calls.length === 1
    ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "set_reminder", input: { when: "2026-11-19T10:00", text: "№237" } }, { type: "tool_use", id: "b", name: "propose_mark_paid", input: { doc_number: "233" } }] }
    : { stop_reason: "end_turn", content: [{ type: "text", text: "Нагадаю завтра о 10:00. Підтвердіть оплату кнопкою." }] }; } } } };
  const saved = [];
  const r = await runAssistant({ history: [], text: "233 сплачено, нагадай завтра о 10 про 237", runtime: rt, client, today: "2026-11-18", chatId: 7, deps: { saveReminder: async (x) => { saved.push(x); return { ok: true, when: "19 листопада о 10:00" }; } } });
  assert.deepEqual(saved, [{ chatId: 7, when: "2026-11-19T10:00", text: "№237" }]);
  assert.deepEqual(r.actions.map((a) => a.callback), ["pay:d1"]);
  assert.match(calls[0].system, /Зараз .* за Києвом/);
  assert.equal(r.answer, "Нагадаю завтра о 10:00. Підтвердіть оплату кнопкою.");
});

test("pay button works only for allowed people", async () => {
  process.env.TELEGRAM_ALLOWED_IDS = "7";
  const tgCalls = [], texts = [], paid = [];
  const deps = { tg: async (m, b) => tgCalls.push(b.text), sendText: async (c, t) => texts.push(t), markPaid: async (id, o) => { paid.push([id, o.who]); return { ok: true, label: "Рахунок №233", amount: 6685, status: "paid" }; } };
  await processCallback({ id: "q1", from: { id: 8 }, data: "pay:d1", message: { chat: { id: 8 } } }, deps);
  assert.equal(paid.length, 0);
  assert.equal(tgCalls[0], "Немає доступу");
  await processCallback({ id: "q2", from: { id: 7, first_name: "Настя" }, data: "pay:d1", message: { chat: { id: 7 } } }, deps);
  assert.deepEqual(paid, [["d1", "Настя"]]);
  assert.match(texts[0], /Рахунок №233: додано оплату 6 685 ₴, статус «оплачено»/);
});
