// GET /api/health — quick check that the server is deployed and configured.
// Reports only whether settings are present, never their values.
import { applyCors, sendJson, allowedEmails } from "./_lib/http.js";

export default function handler(req, res) {
  if (applyCors(req, res)) return;
  sendJson(res, 200, {
    ok: true,
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    allowedEmails: allowedEmails().length,
  });
}
