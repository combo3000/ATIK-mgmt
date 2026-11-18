// /api/telegram-due — sends personal reminders whose time has come (see api/_lib/user-reminders.js).
// Called every 10 minutes by .github/workflows/reminders.yml. Safe to call any time: it only sends
// reminders that are due, each exactly once, and reveals nothing.
import { sendJson } from "./_lib/http.js";
import { deliverDue } from "./_lib/user-reminders.js";
import { sendText } from "./telegram.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.FIREBASE_SERVICE_ACCOUNT) return sendJson(res, 503, { error: "Бот не налаштовано" });
  try {
    const sent = await deliverDue(sendText);
    return sendJson(res, 200, { ok: true, sent });
  } catch (e) {
    console.error("due reminders failed", e);
    return sendJson(res, 500, { error: "Не вдалося" });
  }
}
