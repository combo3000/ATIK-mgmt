// /api/telegram-backup — weekly backup of the whole ATIK database to Telegram.
// Vercel Cron calls it every Sunday evening (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
// By hand: /api/telegram-backup?key=<CRON_SECRET>, or the /backup command in the bot.
// The file is the same format as «Бекап JSON» in the app (Налаштування), so «📂 Відновити» restores it.
// Web orders (a separate collection) are included in the file under "orders" for safekeeping.
import { sendJson } from "./_lib/http.js";
import { getDoc, listDocs } from "./_lib/firestore.js";

export const config = { maxDuration: 60 };

function kyivStamp(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Build the backup object from the shared document and the orders.
export function buildBackup(shared, orders, now = new Date()) {
  const state = (shared && shared.state) || {};
  if (!Array.isArray(state.products) || !Array.isArray(state.buyers)) throw Object.assign(new Error("У базі немає даних додатка"), { status: 502 });
  return {
    ...state,
    exportedAt: now.toISOString(),
    version: "5.0",
    reason: "weekly-telegram",
    source: { revision: shared.revision || null, updatedAt: shared.updatedAt || null },
    orders: orders || [],
  };
}

export function backupSummary(b) {
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  return `точок і покупців ${n(b.buyers)}, документів ${n(b.journal)}, звітів продажів ${n(b.salesReports)}, товарів ${n(b.products)}, інтернет-замовлень ${n(b.orders)}`;
}

async function sendDocument(chatId, filename, text, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption.slice(0, 1000));
  form.append("document", new Blob([text], { type: "application/json" }), filename);
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error("Telegram не прийняв файл: " + (j.description || r.status)), { status: 502 });
}

// Reads the database and sends the file to each chat. Returns a short summary.
export async function sendBackup(chatIds, deps = {}) {
  const db = deps.db || { getDoc, listDocs };
  const [shared, orders] = await Promise.all([db.getDoc("shared/main"), db.listDocs("orders", { pageSize: 300, orderBy: "", all: true }).catch(() => [])]);
  const backup = buildBackup(shared, orders);
  const text = JSON.stringify(backup, null, 1);
  const { date, time } = kyivStamp();
  const filename = `atik_backup_${date}.json`;
  const caption = `💾 Резервна копія ATIK на ${date} ${time}\n${backupSummary(backup)}.\n\nЯк відновити: у додатку Налаштування → «📂 Відновити» → оберіть цей файл.`;
  const send = deps.sendDocument || sendDocument;
  for (const id of chatIds) await send(id, filename, text, caption);
  return { filename, kb: Math.round(text.length / 1024), summary: backupSummary(backup) };
}

export function backupChatIds() {
  const own = (process.env.TELEGRAM_BACKUP_CHAT_IDS || "").split(/[,\s]+/).filter(Boolean);
  return own.length ? own : (process.env.TELEGRAM_ALLOWED_IDS || "").split(/[,\s]+/).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization === `Bearer ${secret}` || (req.query && req.query.key === secret);
  if (!secret || !auth) return sendJson(res, 401, { error: "Немає доступу" });
  if (!process.env.TELEGRAM_BOT_TOKEN) return sendJson(res, 503, { error: "TELEGRAM_BOT_TOKEN не налаштовано" });
  const to = backupChatIds();
  if (!to.length) return sendJson(res, 503, { error: "Немає кому надсилати: заповніть TELEGRAM_ALLOWED_IDS" });
  try {
    const r = await sendBackup(to);
    return sendJson(res, 200, { ok: true, sentTo: to.length, ...r });
  } catch (e) {
    console.error("backup failed", e);
    return sendJson(res, e.status || 500, { error: e.status ? e.message : "Внутрішня помилка" });
  }
}
