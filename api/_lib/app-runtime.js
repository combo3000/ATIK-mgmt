// Runs the app's own code (index.html) on the server over a copy of the shared data, so the
// Telegram bot and the Monday report use exactly the same calculations and assistant tools
// as the in-app assistant. Read-only: nothing here is written back anywhere.
import fs from "node:fs";
import vm from "node:vm";

process.env.TZ = process.env.APP_TZ || "Europe/Kyiv"; // "today" and month boundaries as in Ukraine

export const APP_URL = (process.env.APP_URL || "https://combo3000.github.io/ATIK-mgmt/").replace(/\/?$/, "/");

let scripts = null;
function appScripts() {
  if (scripts) return scripts;
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m, i) => new vm.Script(m[1], { filename: "index.html#" + i }));
  return scripts;
}

// Anything the page touches in the DOM is a harmless no-op.
function stub() {
  const f = function () {};
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => "";
      if (k === "then") return undefined;
      if (k === "length") return 0;
      return stub();
    },
    set() { return true; },
    apply() { return stub(); },
    construct() { return stub(); },
  });
}

export function createAppRuntime(state, { orders = [] } = {}) {
  const store = {};
  const url = new URL(APP_URL);
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error: (...a) => console.error("[app]", ...a) },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Blob, TextEncoder, URL, URLSearchParams, Intl,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: stub(),
    navigator: { userAgent: "atik-server", clipboard: undefined },
    location: { href: url.href, origin: url.origin, protocol: url.protocol, host: url.host, hostname: url.hostname, pathname: url.pathname, search: "", hash: "" },
    history: { replaceState() {}, pushState() {} },
    fetch: () => Promise.reject(new Error("offline")),
    addEventListener() {}, removeEventListener() {},
    alert() {}, confirm: () => false, prompt: () => null,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: () => 0,
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const s of appScripts()) s.runInContext(ctx);
  ctx.__state = JSON.parse(JSON.stringify(state || {}));
  ctx.__orders = JSON.parse(JSON.stringify(orders || []));
  vm.runInContext("applyAppState(__state); ordersData=__orders;", ctx);

  return {
    // Same tools as the in-app assistant. Proposals come back with `link` (what the app should open).
    runTool(name, input) {
      ctx.__name = name; ctx.__input = JSON.parse(JSON.stringify(input || {}));
      const out = vm.runInContext("(function(){ var r; try{ r=asstRunTool(__name,__input); }catch(e){ r={error:String(e&&e.message||e)}; } return JSON.stringify(r&&r.action?{action:{label:r.action.label,link:r.action.link||null}}:r); })()", ctx);
      return JSON.parse(out || "null");
    },
    weeklyData() { return JSON.parse(vm.runInContext("JSON.stringify(buildWeeklyData())", ctx)); },
    today() { return vm.runInContext("todayISO()", ctx); },
    reportReminders(month) { ctx.__month = month || null; return JSON.parse(vm.runInContext("JSON.stringify(reportReminderData(__month))", ctx)); },
  };
}

// Link that opens the app with a proposal ready (the app reads ?do=… on start; nothing is saved by it).
export function appLink(link) {
  if (!link) return APP_URL;
  if (link.url) return link.url;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(link)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return APP_URL + "?" + q.toString();
}
