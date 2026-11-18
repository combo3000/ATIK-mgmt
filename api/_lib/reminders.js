// Text and buttons for the monthly report reminders (pure, so it is easy to test).
import { appLink } from "./app-runtime.js";

// kind: "start" (1st of the month: ask everyone), "check" (8th: who still hasn't sent), "status" (/reports).
export function reminderMessage(data, kind) {
  const pts = data.points || [];
  const missing = pts.filter((p) => !p.reported);
  const done = pts.filter((p) => p.reported);
  const button = (p) => ({ label: `✍️ ${p.name}`, url: appLink({ do: "msg", b: p.id, p: "report" }) });
  const hint = "Кнопка відкриває в додатку готове повідомлення точці: скопіюйте й надішліть у її чат, тоді натисніть «Позначити як надіслане». Сам бот точкам нічого не пише.";
  if (!pts.length) return { text: "Точок під реалізацію з товаром на полиці немає, звіти збирати не треба.", buttons: [] };
  if (kind === "start") {
    return {
      text: `📋 **Час зібрати звіти продажів і залишки за ${data.monthName}.**\nТочок під реалізацію: ${pts.length}` +
        (done.length ? `, уже надіслали: ${done.map((p) => p.name).join(", ")}` : "") +
        (missing.length ? `.\n\nЩе чекаємо від: ${missing.map((p) => p.name).join(", ")}.\n\n${hint}` : ". Усі вже надіслали 🎉"),
      buttons: missing.map(button),
    };
  }
  if (!missing.length) return { text: `✅ Усі ${pts.length} точок під реалізацію надіслали звіт за ${data.monthName}.`, buttons: [] };
  const head = kind === "check"
    ? `⏰ **Минув тиждень, а звіту за ${data.monthName} ще немає від ${missing.length} з ${pts.length} точок:**`
    : `📋 **Звіти за ${data.monthName}:** надіслали ${done.length} з ${pts.length}.\n\n**Ще немає від:**`;
  return {
    text: `${head}\n${missing.map((p) => `• ${p.name}${p.shelfQty ? ` (на полиці ${p.shelfQty} шт.)` : ""}`).join("\n")}\n\n${hint}`,
    buttons: missing.map(button),
  };
}

// Which reminder is due today (Kyiv date): the 1st → start, the 8th → check, otherwise none.
export function reminderKindFor(dayOfMonth) {
  if (dayOfMonth === 1) return "start";
  if (dayOfMonth === 8) return "check";
  return null;
}
