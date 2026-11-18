// /api/telegram — the ATIK assistant in Telegram.
// POST: Telegram webhook (checked by the secret header). Only Telegram IDs in TELEGRAM_ALLOWED_IDS
//       get answers; anyone else is told their ID and nothing more.
// GET ?setup=<TELEGRAM_WEBHOOK_SECRET>: registers this URL as the bot's webhook (one-time setup).
//
// The bot is the same assistant as in the app: same prompt, same tools, run over a read-only copy
// of the shared data. Proposals become buttons that open the app with the draft ready; the person
// checks and confirms there. The bot never saves documents, never deletes, never writes to partners.
import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { sendJson } from "./_lib/http.js";
import { getDoc, setDoc, listDocs } from "./_lib/firestore.js";
import { createAppRuntime, appLink, APP_URL } from "./_lib/app-runtime.js";
import { assistantStep } from "./assistant.js";

export const config = { maxDuration: 60 };

const MAX_STEPS = 8;
const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // a conversation is forgotten after 3 hours of silence
const SESSION_MAX = 12; // messages kept (user + assistant text only)

export const TELEGRAM_SYSTEM = `Ти відповідаєш у Telegram. Пиши коротко: кілька речень або короткий список, без таблиць і заголовків; жирний — **так**.
Кнопки від propose_* з'являються під твоїм повідомленням і відкривають додаток ATIK з готовою чернеткою; людина перевіряє й підтверджує там. Не обіцяй, що щось уже збережено чи надіслано.`;

export function allowedIds() {
  return (process.env.TELEGRAM_ALLOWED_IDS || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error("telegram", method, j.description || r.status);
  return j;
}

export function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// The assistant's light markdown → Telegram HTML
export function toTelegramHtml(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^\s*[-*•]\s+/gm, "• ");
}
// Telegram allows 4096 characters per message; split on paragraph/line boundaries.
export function splitMessage(html, limit = 3900) {
  const parts = [];
  let rest = html;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendText(chatId, text, buttons = []) {
  const parts = splitMessage(toTelegramHtml(text || "…"));
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await tg("sendMessage", {
      chat_id: chatId,
      text: parts[i],
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(last && buttons.length ? { reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.label.slice(0, 60), url: b.url }]) } } : {}),
    });
  }
}

function kyivToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
}

// One conversation turn: the same loop as asstRun() in index.html.
export async function runAssistant({ history, text, runtime, client, today }) {
  const messages = [...history, { role: "user", content: text }];
  const texts = [];
  const actions = [];
  for (let step = 1; step <= MAX_STEPS; step++) {
    const r = await assistantStep({ messages, today, extraSystem: TELEGRAM_SYSTEM }, client);
    const content = r.content || [];
    messages.push({ role: "assistant", content });
    const results = [];
    for (const b of content) {
      if (b.type !== "tool_use") continue;
      const out = runtime.runTool(b.name, b.input || {});
      if (out && out.action) actions.push({ label: out.action.label, url: appLink(out.action.link) });
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out && out.action ? { proposed: true, button: out.action.label } : out).slice(0, 60000) });
    }
    const t = content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (t) texts.push(t);
    if (r.stop_reason !== "tool_use" || !results.length) break;
    messages.push({ role: "user", content: results });
    const onlyActions = content.filter((b) => b.type === "tool_use").every((b) => /^propose_/.test(b.name));
    if (onlyActions) break;
  }
  const answer = texts.length ? texts[texts.length - 1] : actions.length ? "Підготував чернетку, відкрийте кнопкою нижче." : "Не вдалося відповісти, спробуйте переформулювати.";
  return { answer, actions };
}

const HELP = `Привіт! Я асистент ATIK. Питайте про продажі, залишки, борги точок, і я підготую чернетку документа чи повідомлення.

Наприклад:
• Скільки продали в жовтні?
• Хто з точок винен гроші?
• Що закінчується на складі?
• Зроби рахунок Бюро Вин на 10 тубусів 40 шт чорний сандал

Чернетки відкриваються в додатку кнопкою, зберігаєте їх там ви. /new почне розмову спочатку.`;

export async function processUpdate(update, deps = {}) {
  const msg = update && update.message;
  if (!msg || !msg.chat || msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const uid = String(msg.from && msg.from.id || "");
  const send = deps.sendText || sendText;
  if (!allowedIds().includes(uid)) {
    await send(chatId, `Це приватний бот ATIK. Ваш Telegram ID: ${uid}\nЩоб отримати доступ, додайте цей номер у TELEGRAM_ALLOWED_IDS на Vercel.`);
    return;
  }
  const text = String(msg.text || "").trim();
  if (!text) { await send(chatId, "Поки що я розумію лише текстові повідомлення."); return; }
  const sessionPath = `tg_sessions/${chatId}`;
  const db = deps.db || { getDoc, setDoc, listDocs };
  if (/^\/(start|help)\b/.test(text)) { await send(chatId, HELP); return; }
  if (/^\/new\b/.test(text)) { await db.setDoc(sessionPath, { messages: [], updatedAt: Date.now() }); await send(chatId, "Добре, починаємо спочатку."); return; }

  if (!deps.client) tg("sendChatAction", { chat_id: chatId, action: "typing" });
  const [session, shared, orders] = await Promise.all([
    db.getDoc(sessionPath).catch(() => null),
    db.getDoc("shared/main"),
    db.listDocs("orders").catch(() => []),
  ]);
  if (!shared || !shared.state) { await send(chatId, "Не бачу даних додатка в базі. Перевірте FIREBASE_SERVICE_ACCOUNT."); return; }
  const fresh = session && Date.now() - (session.updatedAt || 0) < SESSION_TTL_MS;
  const history = fresh && Array.isArray(session.messages) ? session.messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") : [];
  const runtime = (deps.createRuntime || createAppRuntime)(shared.state, { orders });
  const { answer, actions } = await runAssistant({ history, text, runtime, client: deps.client || new Anthropic(), today: kyivToday() });
  await send(chatId, answer, actions);
  const kept = [...history, { role: "user", content: text.slice(0, 4000) },
    { role: "assistant", content: (answer + (actions.length ? "\n[Кнопки: " + actions.map((a) => a.label).join("; ") + "]" : "")).slice(0, 4000) }].slice(-SESSION_MAX);
  await db.setDoc(sessionPath, { messages: kept, updatedAt: Date.now() }).catch((e) => console.error("session save", e.message));
}

async function setup(req, res) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `https://${host}/api/telegram`;
  const hook = await tg("setWebhook", { url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: true });
  await tg("setMyCommands", { commands: [{ command: "help", description: "Що я вмію" }, { command: "new", description: "Почати розмову спочатку" }] });
  res.status(hook.ok ? 200 : 502).setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(hook.ok ? `Готово: бот підключено до ${url}.\nНапишіть боту в Telegram будь-що, він підкаже ваш Telegram ID.` : `Не вдалося: ${hook.description || "перевірте TELEGRAM_BOT_TOKEN"}`);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!process.env.TELEGRAM_BOT_TOKEN || !secret) return sendJson(res, 503, { error: "TELEGRAM_BOT_TOKEN або TELEGRAM_WEBHOOK_SECRET не налаштовано" });
  if (req.method === "GET") {
    if (req.query && req.query.setup === secret) return setup(req, res);
    return sendJson(res, 200, { ok: true, app: APP_URL });
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "Лише POST" });
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) return sendJson(res, 401, { error: "Невірний секрет" });
  const update = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  // Answer Telegram at once (so it does not resend the update) and keep working in the background.
  const chatId = update && update.message && update.message.chat && update.message.chat.id;
  waitUntil(processUpdate(update).catch(async (e) => {
    console.error("telegram update failed", e);
    if (chatId) await sendText(chatId, e instanceof Anthropic.APIError && e.status === 429 ? "AI перевантажений, спробуйте за хвилину." : "⚠️ Не вдалося відповісти: " + (e.status ? e.message : "внутрішня помилка"));
  }));
  return sendJson(res, 200, { ok: true });
}
