// Marks one document (рахунок or накладна) as paid in the shared database, from the Telegram bot.
// This is the bot's only write to app data, and it runs only when a person presses the button.
// It works like «Додати оплату» in the app: a payment for the whole outstanding amount is added
// (a рахунок then becomes «оплачено»). Exact read-modify-write: only that one document changes,
// every other byte of the data is written back as it was read, and the write fails (and is retried)
// if anyone changed the data in between. The app picks the change up like any other device's edit.
import { getRaw, commit, decodeFields, encodeValue } from "./firestore.js";

const SYNC_SCHEMA = 3;

function kyivDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
}
const round2 = (x) => Math.round(x * 100) / 100;

export function paidSum(doc) {
  const p = Array.isArray(doc.payments) ? doc.payments : [];
  if (!p.length) return doc.status === "paid" ? doc.total || 0 : 0;
  return round2(p.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0));
}
export function outstanding(doc) {
  return Math.max(0, round2((doc.total || 0) - paidSum(doc)));
}

// Pure part: given the decoded document, return its new fields (or a reason it can't be marked).
export function payFields(doc, { who = "", date = kyivDate(), now = new Date() } = {}) {
  const out = outstanding(doc);
  if (out <= 0.01) return { already: true };
  let payments = Array.isArray(doc.payments) ? doc.payments.slice() : [];
  let status = doc.status || "created";
  if (!Array.isArray(doc.payments) && status === "paid") status = "created"; // legacy, same as the app
  payments.push({ id: "tg" + now.getTime().toString(36), date, amount: out, note: "Позначено в Telegram" + (who ? " (" + who + ")" : ""), createdAt: now.toISOString() });
  if (doc.docType === "bill") status = "paid";
  return { amount: out, payments, status };
}

export async function markPaid(docId, { who = "", deps = {} } = {}) {
  const fs = { getRaw, commit, ...deps };
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await fs.getRaw("shared/main");
    if (!raw || !raw.fields || !raw.fields.state) throw Object.assign(new Error("Немає даних додатка в базі"), { status: 502 });
    const stateFields = raw.fields.state.mapValue && raw.fields.state.mapValue.fields || {};
    const values = (stateFields.journal && stateFields.journal.arrayValue && stateFields.journal.arrayValue.values) || [];
    const idx = values.findIndex((v) => v.mapValue && v.mapValue.fields && v.mapValue.fields.id && v.mapValue.fields.id.stringValue === docId);
    if (idx < 0) return { ok: false, reason: "not_found" };
    const doc = decodeFields(values[idx].mapValue.fields);
    const label = (doc.docType === "bill" ? "Рахунок" : "Накладна") + " №" + (doc.invoiceNum || "");
    const ch = payFields(doc, { who });
    if (ch.already) return { ok: false, reason: "already", label };
    const newValues = values.slice();
    newValues[idx] = { mapValue: { fields: { ...values[idx].mapValue.fields, payments: encodeValue(ch.payments), status: encodeValue(ch.status) } } };
    const prevRev = raw.fields.revision && raw.fields.revision.stringValue || null;
    const revision = "rev_" + Date.now() + "_tg" + Math.random().toString(36).slice(2, 6);
    try {
      await fs.commit([{
        update: { name: "shared/main", fields: {
          state: { mapValue: { fields: { ...stateFields, journal: { arrayValue: { values: newValues } } } } },
          schema: encodeValue(SYNC_SCHEMA),
          revision: encodeValue(revision),
          prevRevision: encodeValue(prevRev),
          updatedBy: encodeValue({ uid: "telegram-bot", email: null, name: "Telegram: " + (who || "бот") }),
        } },
        updateMask: { fieldPaths: ["state", "schema", "revision", "prevRevision", "updatedBy"] },
        currentDocument: { updateTime: raw.updateTime },
        updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      }]);
      return { ok: true, label, amount: ch.amount, status: ch.status };
    } catch (e) {
      if (!e.conflict) throw e; // someone saved at the same moment: read again and retry
    }
  }
  throw Object.assign(new Error("База зайнята, спробуйте ще раз"), { status: 503 });
}
