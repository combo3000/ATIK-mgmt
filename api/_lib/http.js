// Shared helpers for ATIK serverless functions (Vercel, Node runtime).
// Files under api/_lib are not exposed as routes.
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "atik-16335";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

// Origins allowed to call the API from a browser: the Vercel deployment itself
// (same origin, no CORS needed), GitHub Pages and Vercel previews.
function allowedOrigin(origin) {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    if (u.hostname === "combo3000.github.io") return origin;
    if (u.hostname === "atik-mgmt.vercel.app") return origin;
    if (/^atik-mgmt-[a-z0-9-]+-combo3000\.vercel\.app$/.test(u.hostname)) return origin;
    if (u.hostname === "localhost") return origin;
  } catch { /* fall through */ }
  return null;
}

export function applyCors(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Verifies the Firebase ID token the app sends (Google sign-in) and checks the
// email against ALLOWED_EMAILS. Returns {email} or throws an Error with .status.
export async function requireUser(req) {
  const allow = allowedEmails();
  if (!allow.length) throw httpError(503, "ALLOWED_EMAILS не налаштовано на сервері");
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) throw httpError(401, "Потрібен вхід через Google");
  let payload;
  try {
    ({ payload } = await jwtVerify(m[1], GOOGLE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    }));
  } catch {
    throw httpError(401, "Сесія недійсна, увійдіть ще раз");
  }
  const email = String(payload.email || "").toLowerCase();
  if (!email || payload.email_verified !== true || !allow.includes(email)) {
    throw httpError(403, "Цей акаунт не має доступу до AI-асистента");
  }
  return { email };
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
