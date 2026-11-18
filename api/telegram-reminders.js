// /api/telegram-reminders — monthly reminders to collect sales reports from consignment points.
// Vercel Cron calls it every morning (07:00 UTC); it acts only on the 1st (ask everyone for the
// previous month's report) and the 8th (list who still hasn't sent it). Each point gets a button that
// opens the ready message in the app; the person sends it. The bot never writes to points itself.
// By hand: /api/telegram-reminders?key=<CRON_SECRET>&kind=start|check
import { sendJson } from "./_lib/http.js";
import { getDoc } from "./_lib/firestore.js";
import { createAppRuntime } from "./_lib/app-runtime.js";
import { reminderMessage, reminderKindFor } from "./_lib/reminders.js";
import { sendText, allowedIds } from "./telegram.js";
import { deliverDue } from "./_lib/user-reminders.js";

export const config = { maxDuration: 60 };

function kyivDay() {
  return +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", day: "numeric" }).format(new Date());
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const q = req.query || {};
  const auth = req.headers.authorization === `Bearer ${secret}` || q.key === secret;
  if (!secret || !auth) return sendJson(res, 401, { error: "Немає доступу" });
  if (!process.env.TELEGRAM_BOT_TOKEN) return sendJson(res, 503, { error: "TELEGRAM_BOT_TOKEN не налаштовано" });
  await deliverDue(sendText).catch((e) => console.error("due reminders", e.message)); // daily backup for personal reminders
  const kind = ["start", "check"].includes(q.kind) ? q.kind : reminderKindFor(kyivDay());
  if (!kind) return sendJson(res, 200, { ok: true, skipped: "не 1-ше і не 8-ме число" });
  const to = (process.env.TELEGRAM_REPORT_CHAT_IDS || "").split(/[,\s]+/).filter(Boolean);
  const chats = to.length ? to : allowedIds();
  if (!chats.length) return sendJson(res, 503, { error: "Немає кому надсилати: заповніть TELEGRAM_ALLOWED_IDS" });
  try {
    const shared = await getDoc("shared/main");
    if (!shared || !shared.state) return sendJson(res, 502, { error: "Немає даних додатка в базі" });
    const data = createAppRuntime(shared.state).reportReminders();
    const m = reminderMessage(data, kind);
    for (const id of chats) await sendText(id, m.text, m.buttons);
    return sendJson(res, 200, { ok: true, kind, month: data.month, points: data.points.length, missing: data.points.filter((p) => !p.reported).length });
  } catch (e) {
    console.error("reminders failed", e);
    return sendJson(res, e.status || 500, { error: e.status ? e.message : "Внутрішня помилка" });
  }
}
