// Personal reminders from the Telegram bot ("нагадай завтра о 10 про №237").
// Stored in Firestore tg_reminders (the bot's own collection, not app data) and delivered by
// /api/telegram-due, which runs every 10 minutes (GitHub Actions) and on every bot message.
import { setDoc, listDocs, deleteDoc } from "./firestore.js";

const TZ = "Europe/Kyiv";

function tzOffsetMs(utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

// "2026-11-19T10:00" (Kyiv wall clock) → Date
export function kyivToDate(when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(String(when || "").trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] === undefined ? 10 : +m[4], m[5] === undefined ? 0 : +m[5]);
  let t = guess - tzOffsetMs(guess);
  t = guess - tzOffsetMs(t);
  return new Date(t);
}

export function kyivLabel(date) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function kyivNow() {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

export async function saveReminder({ chatId, when, text }, deps = {}) {
  const at = kyivToDate(when);
  if (!at || isNaN(at)) return { error: "Не зрозумів дату й час. Потрібно YYYY-MM-DDTHH:MM за Києвом." };
  const now = Date.now();
  if (at.getTime() < now - 60000) return { error: "Цей час уже минув (" + kyivLabel(at) + ")." };
  if (at.getTime() > now + 366 * 86400000) return { error: "Нагадування можна ставити не більше ніж на рік уперед." };
  const msg = String(text || "").trim().slice(0, 500);
  if (!msg) return { error: "Порожній текст нагадування." };
  const id = `${chatId}_${at.getTime()}_${Math.random().toString(36).slice(2, 6)}`;
  await (deps.setDoc || setDoc)(`tg_reminders/${id}`, { chatId: String(chatId), at: at.toISOString(), text: msg, createdAt: new Date().toISOString() });
  return { ok: true, when: kyivLabel(at) };
}

// Sends every reminder whose time has come. Each one is claimed by deleting it first, so two runs at
// the same moment never send it twice.
export async function deliverDue(send, deps = {}) {
  const list = await (deps.listDocs || listDocs)("tg_reminders", { orderBy: "", pageSize: 300, all: true });
  const now = Date.now();
  let sent = 0;
  for (const r of list) {
    if (!r.at || new Date(r.at).getTime() > now + 30000) continue;
    const claimed = await (deps.deleteDoc || deleteDoc)(`tg_reminders/${r._id}`);
    if (!claimed) continue;
    await send(r.chatId, `⏰ **Нагадування:** ${r.text}`);
    sent++;
  }
  return sent;
}
