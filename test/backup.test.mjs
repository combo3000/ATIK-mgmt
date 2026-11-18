// Weekly backup to Telegram: file format matches the app's «Бекап JSON», all data is included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackup, sendBackup, backupSummary } from "../api/telegram-backup.js";
import { processUpdate } from "../api/telegram.js";

const shared = { revision: "rev_1", state: { products: [{ id: "p1" }], buyers: [{ id: "b1" }], journal: [{ id: "j1" }, { id: "j2" }], salesReports: [], leads: [{ id: "l1" }], settings: { a: 1 } } };

test("backup keeps every part of the app state plus orders", () => {
  const b = buildBackup(shared, [{ _id: "o1" }], new Date("2026-11-22T19:00:00Z"));
  assert.equal(b.version, "5.0");
  assert.equal(b.exportedAt, "2026-11-22T19:00:00.000Z");
  assert.deepEqual(b.journal, shared.state.journal);
  assert.deepEqual(b.leads, shared.state.leads);
  assert.equal(b.orders.length, 1);
  assert.match(backupSummary(b), /документів 2/);
  assert.throws(() => buildBackup({ state: {} }, []), /немає даних/);
});

test("sendBackup sends one JSON file to each chat", async () => {
  const sent = [];
  const db = { getDoc: async () => shared, listDocs: async (c, o) => { assert.equal(o.all, true); return [{ _id: "o1" }]; } };
  const r = await sendBackup(["1", "2"], { db, sendDocument: async (id, name, text, caption) => sent.push({ id, name, data: JSON.parse(text), caption }) });
  assert.equal(sent.length, 2);
  assert.match(sent[0].name, /^atik_backup_\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(sent[0].data.products[0].id, "p1");
  assert.match(sent[0].caption, /Відновити/);
  assert.ok(r.kb >= 0);
});

test("/backup works only for allowed users", async () => {
  process.env.TELEGRAM_ALLOWED_IDS = "7";
  const calls = [], texts = [];
  const deps = { sendText: async (c, t) => texts.push(t), sendBackup: async (ids) => calls.push(ids), db: {} };
  await processUpdate({ message: { chat: { id: 8, type: "private" }, from: { id: 8 }, text: "/backup" } }, deps);
  assert.equal(calls.length, 0);
  await processUpdate({ message: { chat: { id: 7, type: "private" }, from: { id: 7 }, text: "/backup" } }, deps);
  assert.deepEqual(calls, [[7]]);
});
