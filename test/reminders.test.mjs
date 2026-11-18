// Monthly report reminders: who is asked, who is chased a week later, buttons to ready messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppRuntime } from "../api/_lib/app-runtime.js";
import { reminderMessage, reminderKindFor } from "../api/_lib/reminders.js";
import { processUpdate } from "../api/telegram.js";

const ym = (n) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth() + n, 1); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0"); };
const prev = ym(-1);
const state = {
  buyers: [
    { id: "t1", name: "ФОП Альфа", retailName: "Альфа Тест", isRetail: true, dealType: "consignment", telegram: "@alfa" },
    { id: "t2", name: "ФОП Бета", retailName: "Бета Тест", isRetail: true, dealType: "consignment" },
    { id: "t3", name: "ФОП Гама", retailName: "Гама Тест", isRetail: true, dealType: "prepay" },
    { id: "t4", name: "ФОП Дельта", retailName: "Дельта Тест", isRetail: true, dealType: "consignment" },
  ],
  retailStock: { t1: { cherry20: { qty: 5, name: "Cherry" } }, t2: { cherry20: { qty: 3, name: "Cherry" } }, t3: { cherry20: { qty: 9, name: "Cherry" } } },
  salesReports: [{ id: "r1", buyerId: "t1", buyerName: "Альфа Тест", month: prev, savedAt: new Date().toISOString(), items: [] }],
  journal: [],
};

test("only active consignment points; report status for last month", () => {
  const d = createAppRuntime(state).reportReminders();
  assert.equal(d.month, prev);
  const mine = d.points.filter((p) => /Тест$/.test(p.name));
  assert.deepEqual(mine.map((p) => [p.name, p.reported]), [["Альфа Тест", true], ["Бета Тест", false]]);
  assert.match(mine[1].text, /звіт продажів за/);
  assert.equal(mine[0].chat, "Telegram");
});

test("start asks everyone missing, check lists who is still missing, with buttons", () => {
  const data = { month: prev, monthName: "жовтень", points: [{ id: "t1", name: "Альфа", reported: true, shelfQty: 5 }, { id: "t2", name: "Бета", reported: false, shelfQty: 3 }] };
  const s = reminderMessage(data, "start");
  assert.match(s.text, /Час зібрати звіти/);
  assert.match(s.text, /Ще чекаємо від: Бета/);
  assert.equal(s.buttons.length, 1);
  assert.match(s.buttons[0].url, /\?do=msg&b=t2&p=report$/);
  const c = reminderMessage(data, "check");
  assert.match(c.text, /Минув тиждень/);
  assert.match(c.text, /• Бета \(на полиці 3 шт\.\)/);
  const all = reminderMessage({ ...data, points: [data.points[0]] }, "check");
  assert.match(all.text, /Усі 1 точок/);
  assert.equal(all.buttons.length, 0);
  assert.equal(reminderKindFor(1), "start");
  assert.equal(reminderKindFor(8), "check");
  assert.equal(reminderKindFor(15), null);
});

test("/reports in the bot shows the status", async () => {
  process.env.TELEGRAM_ALLOWED_IDS = "7";
  const out = [];
  await processUpdate({ message: { chat: { id: 7, type: "private" }, from: { id: 7 }, text: "/reports" } },
    { sendText: async (c, t, b) => out.push({ t, b }), db: { getDoc: async () => ({ state }) } });
  assert.match(out[0].t, /Ще немає від/);
  assert.ok(out[0].b.some((b) => b.label.includes("Бета Тест")));
});
