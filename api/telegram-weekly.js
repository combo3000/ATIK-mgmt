// /api/telegram-weekly — the Monday report in Telegram.
// Vercel Cron calls it every Monday (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
// To try it by hand: open /api/telegram-weekly?key=<CRON_SECRET>.
// Numbers come from the app's own buildWeeklyData(); Claude only writes the summary and the to-do list
// (the same /api/weekly-report logic as the «Звіт тижня» button in the app).
import Anthropic from "@anthropic-ai/sdk";
import { sendJson } from "./_lib/http.js";
import { getDoc, listDocs } from "./_lib/firestore.js";
import { createAppRuntime, APP_URL } from "./_lib/app-runtime.js";
import { weeklyReport } from "./weekly-report.js";
import { sendText, allowedIds } from "./telegram.js";

export const config = { maxDuration: 60 };

const fmt = (n) => Math.round(n || 0).toLocaleString("uk-UA").replace(/ /g, " ");

export function reportText(d, ai) {
  const mark = { high: "🔴", medium: "🟡", low: "⚪" };
  const w = d.week, g = d.goal;
  const lines = [`**Звіт за тиждень** (${d.period.from} — ${d.period.to})`, ""];
  if (ai && ai.headline) lines.push(`**${ai.headline}**`, ai.summary || "", "");
  lines.push(
    `• Ціль: ${fmt(g.done)} ₴ з ${fmt(g.amount)} ₴ (${g.pct}%), минуло ${g.timeElapsedPct}% часу, лишилось ${g.daysLeft} дн.`,
    `• Оплати за тиждень: ${fmt(w.paid)} ₴`,
    `• Накладних ${w.invoices.count} на ${fmt(w.invoices.sum)} ₴, рахунків ${w.bills.count} на ${fmt(w.bills.sum)} ₴`,
    `• Звіти точок: ${w.salesReports.length ? w.salesReports.map((r) => `${r.point} (${r.sold} шт.)`).join(", ") : "не було"}`,
    `• Борги точок: ${fmt(d.partners.debtTotal)} ₴`,
  );
  if (w.webOrders && w.webOrders.unconfirmed) lines.push(`• Непідтверджених інтернет-замовлень: ${w.webOrders.unconfirmed}`);
  if (d.rawToOrder && d.rawToOrder.length) lines.push(`• Сировина: ${d.rawToOrder.map((o) => `${o.supplier} ${o.now ? "замовити зараз" : "до " + o.orderBy}`).join("; ")}`);
  if (ai && ai.actions && ai.actions.length) {
    lines.push("", "**Що зробити цього тижня**");
    ai.actions.forEach((a, i) => lines.push(`${i + 1}. ${mark[a.priority] || ""} ${a.title}${a.partner ? " · " + a.partner : ""}${a.details ? " — " + a.details : ""}`));
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization === `Bearer ${secret}` || (req.query && req.query.key === secret);
  if (!secret || !auth) return sendJson(res, 401, { error: "Немає доступу" });
  if (!process.env.TELEGRAM_BOT_TOKEN) return sendJson(res, 503, { error: "TELEGRAM_BOT_TOKEN не налаштовано" });
  const chats = (process.env.TELEGRAM_REPORT_CHAT_IDS || "").split(/[,\s]+/).filter(Boolean);
  const to = chats.length ? chats : allowedIds();
  if (!to.length) return sendJson(res, 503, { error: "Немає кому надсилати: заповніть TELEGRAM_ALLOWED_IDS" });
  try {
    const [shared, orders] = await Promise.all([getDoc("shared/main"), listDocs("orders").catch(() => [])]);
    if (!shared || !shared.state) return sendJson(res, 502, { error: "Немає даних додатка в базі" });
    const data = createAppRuntime(shared.state, { orders }).weeklyData();
    let ai = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try { ai = await weeklyReport({ json: JSON.stringify(data).slice(0, 60000) }, new Anthropic()); }
      catch (e) { console.error("weekly AI failed", e.message); }
    }
    const text = reportText(data, ai);
    for (const chatId of to) await sendText(chatId, text, [{ label: "Відкрити ATIK", url: APP_URL }]);
    return sendJson(res, 200, { ok: true, sentTo: to.length, ai: !!ai });
  } catch (e) {
    console.error("weekly report failed", e);
    return sendJson(res, e.status || 500, { error: e.status ? e.message : "Внутрішня помилка" });
  }
}
