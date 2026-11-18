// Minimal Firestore REST client for the server (Telegram bot, Monday report).
// Signs in with the service account in FIREBASE_SERVICE_ACCOUNT (the JSON file from
// Firebase → Project settings → Service accounts). The bot only READS the app's data
// (shared/main, orders); its own conversation memory lives in tg_sessions.
import { SignJWT, importPKCS8 } from "jose";
import { httpError } from "./http.js";

let cached = null; // { token, exp, projectId }

export function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw httpError(503, "FIREBASE_SERVICE_ACCOUNT не налаштовано на сервері");
  let sa;
  try { sa = JSON.parse(raw); } catch { throw httpError(503, "FIREBASE_SERVICE_ACCOUNT: це має бути весь вміст файла .json"); }
  if (!sa.client_email || !sa.private_key) throw httpError(503, "FIREBASE_SERVICE_ACCOUNT: у файлі немає client_email або private_key");
  return { ...sa, private_key: String(sa.private_key).replace(/\\n/g, "\n") };
}

async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached;
  const sa = serviceAccount();
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: sa.private_key_id })
    .setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw httpError(502, "Не вдалося увійти в Firebase сервісним ключем");
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, projectId: sa.project_id || process.env.FIREBASE_PROJECT_ID || "atik-16335" };
  return cached;
}

// Firestore typed value → plain JS
export function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("referenceValue" in v) return v.referenceValue;
  if ("bytesValue" in v) return v.bytesValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  return null;
}
export function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = decodeValue(fields[k]);
  return out;
}
// Plain JS → Firestore typed value (for the bot's own session documents)
export function encodeValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === "string") return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(encodeValue) } };
  const fields = {};
  for (const k of Object.keys(x)) fields[k] = encodeValue(x[k]);
  return { mapValue: { fields } };
}

async function api(path, init = {}) {
  const { token, projectId } = await accessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(502, "Firestore: " + (j.error && j.error.message || r.status));
  return j;
}

export async function getDoc(path) {
  const j = await api(path);
  return j ? decodeFields(j.fields || {}) : null;
}

export async function setDoc(path, obj) {
  const fields = encodeValue(obj).mapValue.fields;
  await api(path, { method: "PATCH", body: JSON.stringify({ fields }) });
}

// Newest documents of a collection (used for web orders).
// all: true follows every page (for backups).
export async function listDocs(collection, { pageSize = 100, orderBy = "createdAt desc", all = false } = {}) {
  const out = [];
  let pageToken = "";
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ pageSize: String(pageSize) });
    if (orderBy) q.set("orderBy", orderBy);
    if (pageToken) q.set("pageToken", pageToken);
    const j = await api(`${collection}?${q}`);
    for (const d of (j && j.documents) || []) out.push({ _id: d.name.split("/").pop(), ...decodeFields(d.fields || {}) });
    pageToken = j && j.nextPageToken;
    if (!all || !pageToken) break;
  }
  return out;
}
