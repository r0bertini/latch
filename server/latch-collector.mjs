/*!
 * Latch Collector — the hosted analytics/observability control plane.
 *
 * A tiny, zero-dependency Node service (built-ins only) that:
 *   - issues per-site project keys           POST /api/v1/sites
 *   - ingests tool-usage telemetry           POST /api/v1/collect
 *   - serves aggregated stats                 GET  /api/v1/stats?k=KEY&days=N
 *   - serves the dashboard UI                 GET  /app
 *
 * Telemetry is metadata only: tool name, outcome, page path, and the AGENT
 * browser's User-Agent. Never form contents, never query strings, no PII from
 * the host page. Latch on a customer site only reports when a key is present.
 *
 * Storage: node:sqlite (built into Node >= 22.5). Binds 127.0.0.1 only;
 * nginx terminates the public side. Run: node latch-collector.mjs
 * Admin:  node latch-collector.mjs set-plan <key> pro|free
 *         node latch-collector.mjs list-sites
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.LATCH_PORT || 8787);
const HOST = process.env.LATCH_HOST || "127.0.0.1";
const DB_PATH = process.env.LATCH_DB || "/var/lib/latch/latch.db";
const HERE = dirname(fileURLToPath(import.meta.url));

// Free plan limits; Pro unlocks the rest.
const FREE_DAYS = 14;
const PRO_DAYS = 90;
const FREE_RECENT = 25;
const PRO_RECENT = 500;

// ---- storage ---------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sites (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT,
    plan       TEXT NOT NULL DEFAULT 'free',
    created_at INTEGER NOT NULL,
    pro_since  INTEGER
  );
  CREATE TABLE IF NOT EXISTS events (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    key   TEXT NOT NULL,
    ts    INTEGER NOT NULL,         -- ms epoch
    type  TEXT NOT NULL,            -- 'register' | 'call' | 'pageview'
    tool  TEXT,
    ok    INTEGER,                  -- 1 ok, 0 fail, NULL n/a
    path  TEXT,
    agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_key_ts ON events(key, ts);
`);

const q = {
  siteByKey: db.prepare("SELECT * FROM sites WHERE key = ?"),
  insertSite: db.prepare(
    "INSERT INTO sites (key, name, email, plan, created_at) VALUES (?, ?, ?, 'free', ?)"
  ),
  insertEvent: db.prepare(
    "INSERT INTO events (key, ts, type, tool, ok, path, agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ),
  setPlan: db.prepare("UPDATE sites SET plan = ?, pro_since = ? WHERE key = ?"),
};

const now = () => Date.now();
const newKey = () => "lk_" + randomBytes(18).toString("base64url");

// ---- helpers ---------------------------------------------------------------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string";
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "content-type": isJson ? "application/json" : "text/html; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    let data = "", over = false;
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) { over = true; req.destroy(); }
    });
    req.on("end", () => resolve(over ? null : data));
    req.on("error", () => resolve(null));
  });
}

function clampStr(s, n) {
  if (s == null) return null;
  s = String(s);
  return s.length > n ? s.slice(0, n) : s;
}

// ---- aggregation -----------------------------------------------------------
function buildStats(site, days) {
  const isPro = site.plan === "pro";
  const maxDays = isPro ? PRO_DAYS : FREE_DAYS;
  const window = Math.min(Math.max(1, days || 30), maxDays);
  const since = now() - window * 86400_000;
  const recentCap = isPro ? PRO_RECENT : FREE_RECENT;

  const totalsRow = db.prepare(`
    SELECT
      COUNT(*) AS events,
      SUM(type = 'call')     AS calls,
      SUM(type = 'register') AS registers,
      SUM(type = 'pageview') AS pageviews,
      SUM(type = 'call' AND ok = 1) AS call_ok,
      SUM(type = 'call' AND ok = 0) AS call_fail
    FROM events WHERE key = ? AND ts >= ?
  `).get(site.key, since);

  const byTool = db.prepare(`
    SELECT tool,
           SUM(type = 'call') AS calls,
           SUM(type = 'call' AND ok = 1) AS ok,
           SUM(type = 'call' AND ok = 0) AS fail
    FROM events WHERE key = ? AND ts >= ? AND tool IS NOT NULL
    GROUP BY tool ORDER BY calls DESC, tool ASC
  `).all(site.key, since);

  const byDay = db.prepare(`
    SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day,
           SUM(type = 'call') AS calls
    FROM events WHERE key = ? AND ts >= ?
    GROUP BY day ORDER BY day ASC
  `).all(site.key, since);

  const byAgent = db.prepare(`
    SELECT agent, COUNT(*) AS n
    FROM events WHERE key = ? AND ts >= ? AND agent IS NOT NULL AND agent != ''
    GROUP BY agent ORDER BY n DESC LIMIT 8
  `).all(site.key, since);

  const recent = db.prepare(`
    SELECT ts, type, tool, ok, path
    FROM events WHERE key = ? AND ts >= ?
    ORDER BY ts DESC LIMIT ?
  `).all(site.key, since, recentCap);

  const calls = Number(totalsRow.calls || 0);
  const callOk = Number(totalsRow.call_ok || 0);

  return {
    plan: site.plan,
    site: { name: site.name, created_at: site.created_at },
    range_days: window,
    max_days: maxDays,
    locked: !isPro,                       // dashboard hint: more history on Pro
    totals: {
      events: Number(totalsRow.events || 0),
      calls,
      registers: Number(totalsRow.registers || 0),
      pageviews: Number(totalsRow.pageviews || 0),
      call_ok: callOk,
      call_fail: Number(totalsRow.call_fail || 0),
    },
    success_rate: calls ? Math.round((callOk / calls) * 1000) / 10 : null,
    by_tool: byTool.map((r) => ({
      tool: r.tool, calls: Number(r.calls || 0),
      ok: Number(r.ok || 0), fail: Number(r.fail || 0),
    })),
    by_day: byDay.map((r) => ({ day: r.day, calls: Number(r.calls || 0) })),
    by_agent: isPro
      ? byAgent.map((r) => ({ agent: r.agent, n: Number(r.n || 0) }))
      : [],                               // agent breakdown is a Pro feature
    recent: recent.map((r) => ({
      ts: r.ts, type: r.type, tool: r.tool, ok: r.ok, path: r.path,
    })),
  };
}

// ---- routing ---------------------------------------------------------------
let APP_HTML = "";
try { APP_HTML = readFileSync(join(HERE, "app.html"), "utf8"); } catch { /* set at deploy */ }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, "");

  // Dashboard UI
  if (req.method === "GET" && (path === "/app" || path === "/app/")) {
    return send(res, 200, APP_HTML || "<h1>Latch dashboard</h1>");
  }

  if (req.method === "GET" && path === "/api/v1/health") {
    return send(res, 200, { ok: true, ts: now() });
  }

  // Create a project (free tier) -> returns a key.
  if (req.method === "POST" && path === "/api/v1/sites") {
    const raw = await readBody(req);
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
    const name = clampStr((body.name || "").trim(), 80);
    const email = clampStr((body.email || "").trim(), 160);
    if (!name) return send(res, 400, { error: "name required" });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return send(res, 400, { error: "valid email required" });
    const key = newKey();
    q.insertSite.run(key, name, email, now());
    return send(res, 201, { key, plan: "free" });
  }

  // Ingest telemetry. Sent via sendBeacon as text/plain to avoid CORS preflight.
  if (req.method === "POST" && path === "/api/v1/collect") {
    const raw = await readBody(req);
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch { return send(res, 204, ""); }
    const site = body.k && q.siteByKey.get(body.k);
    if (!site) return send(res, 202, { ok: false }); // unknown key: accept-and-drop
    const agent = clampStr(req.headers["user-agent"] || "", 180);
    const evs = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
    for (const e of evs) {
      const type = e && e.t;
      if (type !== "register" && type !== "call" && type !== "pageview") continue;
      const ok = e.ok === 1 || e.ok === true ? 1 : e.ok === 0 || e.ok === false ? 0 : null;
      q.insertEvent.run(
        site.key,
        Number(e.ts) || now(),
        type,
        clampStr(e.tool || null, 60),
        ok,
        clampStr(e.p || null, 200),
        agent
      );
    }
    return send(res, 204, "");
  }

  // Aggregated stats for a key.
  if (req.method === "GET" && path === "/api/v1/stats") {
    const key = url.searchParams.get("k");
    const site = key && q.siteByKey.get(key);
    if (!site) return send(res, 404, { error: "unknown key" });
    const days = Number(url.searchParams.get("days")) || 30;
    return send(res, 200, buildStats(site, days));
  }

  return send(res, 404, { error: "not found" });
});

// ---- admin CLI -------------------------------------------------------------
const [, , cmd, a1, a2] = process.argv;
if (cmd === "set-plan") {
  const plan = a2 === "pro" ? "pro" : "free";
  const r = q.setPlan.run(plan, plan === "pro" ? now() : null, a1);
  console.log(r.changes ? `ok: ${a1} -> ${plan}` : `no site with key ${a1}`);
  process.exit(0);
} else if (cmd === "list-sites") {
  for (const s of db.prepare("SELECT key, name, email, plan, created_at FROM sites ORDER BY created_at DESC").all())
    console.log(`${s.plan.padEnd(4)} ${s.key}  ${s.name}  <${s.email || ""}>`);
  process.exit(0);
} else {
  server.listen(PORT, HOST, () =>
    console.log(`latch-collector listening on http://${HOST}:${PORT}  db=${DB_PATH}`)
  );
}
