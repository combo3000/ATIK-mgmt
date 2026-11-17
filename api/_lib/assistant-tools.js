// Tools of the ATIK assistant. Read tools return numbers the app has counted; action tools only
// PROPOSE a draft (the person presses a button to open it and confirms it there).
// The in-app chat runs these in the browser over the app's own data; a Telegram window can later
// run the same names on the server.
const point = { type: "string", description: "Назва точки так, як її називає людина (можна частково)" };
const period = { type: "string", enum: ["month", "quarter", "year", "all"], description: "Швидкий період: цей місяць, цей квартал, цей рік або весь час. Для будь-якого іншого періоду використовуй from/to." };
const from = { type: "string", description: "Початок періоду: місяць YYYY-MM або дата YYYY-MM-DD (включно). Якщо вказано from/to, period ігнорується." };
const to = { type: "string", description: "Кінець періоду: місяць YYYY-MM або дата YYYY-MM-DD (включно). Для одного місяця from=to=YYYY-MM." };

export const READ_TOOLS = [
  { name: "get_overview", description: "Загальна картина: ціль місяця і прогрес, продажі (накладні) й отримані оплати за період ціли, кількість точок, сумарний борг, що потребує уваги.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_points", description: "Усі партнерські точки: умова (під реалізацію/передоплата), на полиці шт, продаж шт/міс за звітами, борг ₴, дата останнього звіту й накладної, що зробити.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_point", description: "Деталі однієї точки: залишок на полиці по товарах, звіти продажів (за період або останні 12), накладні й неоплачені рахунки, що довезти, що не продається.", input_schema: { type: "object", properties: { point, from, to }, required: ["point"], additionalProperties: false } },
  { name: "get_sales", description: "Продажі (відвантажені накладні) за будь-який період, згруповані за товарами, покупцями або місяцями: шт і ₴. Для «липень» став from=to=YYYY-07; для порівняння місяців — group_by=month.", input_schema: { type: "object", properties: { period, from, to, group_by: { type: "string", enum: ["product", "buyer", "month"], description: "month — розбивка по місяцях (для порівняння місяців)" } }, required: ["group_by"], additionalProperties: false } },
  { name: "get_stock", description: "Залишки: готовий товар на складі по позиціях і сировина (палички по ароматах) з прогнозом, коли замовляти.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_abc", description: "ABC-аналіз асортименту: класи A/B/C, частки й поради.", input_schema: { type: "object", properties: { period, from, to, basis: { type: "string", enum: ["revenue", "sold"], description: "revenue — за виручкою з накладних, sold — за продажами в точках зі звітів" } }, required: ["basis"], additionalProperties: false } },
  { name: "get_funnel", description: "Воронка нових точок: заклади на етапах контакт → пробник → перша поставка → партнер, скільки днів на етапі, нотатки, останні дії.", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "find_documents", description: "Пошук документів (накладні, рахунки): за точкою/покупцем, типом, періодом, лише неоплачені.", input_schema: { type: "object", properties: { buyer: { type: "string" }, doc_type: { type: "string", enum: ["invoice", "bill", "any"] }, period, from, to, unpaid_only: { type: "boolean" } }, additionalProperties: false } },
];

export const ACTION_TOOLS = [
  { name: "propose_restock_invoice", description: "Запропонувати чернетку накладної на поповнення для точки (за її продажами або як остання накладна). Людина сама відкриє, перевірить і згенерує.", input_schema: { type: "object", properties: { point }, required: ["point"], additionalProperties: false } },
  { name: "propose_partner_message", description: "Запропонувати повідомлення точці (звіт, оплата, дозамовлення тощо). Відкриється вікно «Написати»; надсилає людина сама.", input_schema: { type: "object", properties: { point, purpose: { type: "string", enum: ["report", "payment", "bill", "restock", "tryNew", "thanks", "custom"] } }, required: ["point"], additionalProperties: false } },
  { name: "propose_reconciliation_act", description: "Запропонувати акт звірки з точкою (PDF).", input_schema: { type: "object", properties: { point }, required: ["point"], additionalProperties: false } },
  { name: "propose_order_link", description: "Запропонувати скопіювати особисте посилання для замовлення точки.", input_schema: { type: "object", properties: { point }, required: ["point"], additionalProperties: false } },
  { name: "propose_sales_report", description: "Запропонувати внести звіт продажів точки (файл, фото або текст розпізнає AI у вікні звіту).", input_schema: { type: "object", properties: {}, additionalProperties: false } },
];

export const TOOLS = [...READ_TOOLS, ...ACTION_TOOLS];
export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
