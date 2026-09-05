// =============================================================================
// linktrack — a prototype link-tracking / click-analytics service (for learning)
// =============================================================================
//
// The whole idea in one paragraph:
//   You create a short "tracking link" that points at THIS server. When someone
//   opens it, the server records everything the HTTP request reveals (IP, User-
//   Agent, language, referer...), optionally serves a tiny page that runs JS to
//   collect richer client-side details (screen, timezone, GPU...), and then
//   sends the visitor on to a real destination URL. You watch the hits roll in
//   on a dashboard.
//
// This is the same core mechanism used by URL shorteners (Bitly), marketing
// UTM trackers, and email open-tracking pixels. The tech is neutral; using it
// responsibly means telling people they're being tracked and having a reason.
//
// Storage is a plain JSON file (data.json) so there's nothing to install beyond
// three small pure-JS packages. Not production-grade — it's a teaching model.
// =============================================================================

import express from "express";
import { nanoid } from "nanoid";
import { UAParser } from "ua-parser-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3000;
// PUBLIC_BASE is the address people will actually click. Locally it's
// http://localhost:3000. If you tunnel it out (ngrok/cloudflared) put that URL
// here so generated links are clickable from other devices.
const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://localhost:${PORT}`;

// ---- tiny JSON "database" ---------------------------------------------------
// { links: { code -> {code, destination, label, createdAt} },
//   hits:  [ {code, ...everything we captured...} ] }
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { links: {}, hits: [] };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", true); // so req.ip respects X-Forwarded-For behind a tunnel/proxy

// Serve the dashboard + collector page from /public
app.use("/app", express.static(path.join(__dirname, "public")));

// -----------------------------------------------------------------------------
// 1) CREATE a tracking link
//    POST /api/links  { destination, label } -> { code, trackingUrl }
// -----------------------------------------------------------------------------
app.post("/api/links", (req, res) => {
  const { destination, label } = req.body;
  if (!destination || !/^https?:\/\//i.test(destination)) {
    return res.status(400).json({ error: "destination must be a full http(s) URL" });
  }
  const db = loadDB();
  const code = nanoid(7); // e.g. "V1StGXR"
  db.links[code] = {
    code,
    destination,
    label: label || "",
    createdAt: new Date().toISOString(),
  };
  saveDB(db);
  res.json({ code, trackingUrl: `${PUBLIC_BASE}/t/${code}` });
});

// List links + hit counts (for the dashboard)
app.get("/api/links", (req, res) => {
  const db = loadDB();
  const counts = {};
  for (const h of db.hits) counts[h.code] = (counts[h.code] || 0) + 1;
  const links = Object.values(db.links)
    .map((l) => ({ ...l, hits: counts[l.code] || 0, trackingUrl: `${PUBLIC_BASE}/t/${l.code}` }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(links);
});

// Get all hits for one link
app.get("/api/links/:code/hits", (req, res) => {
  const db = loadDB();
  const hits = db.hits.filter((h) => h.code === req.params.code).reverse();
  res.json(hits);
});

// -----------------------------------------------------------------------------
// 2) THE TRACKING ENDPOINT — this is what a visitor's browser actually opens.
//    /t/:code
//
//    Two-step design so we get BOTH server-side and client-side data:
//    (a) We record everything the request already reveals (works even with JS
//        off — this is the reliable part).
//    (b) We serve a tiny landing page (collect.html) that runs JS to gather
//        richer details, POSTs them back to /api/collect, then redirects the
//        visitor to the real destination.
//
//    NOTE for learning: a "purist" tracker could 302-redirect immediately with
//    zero landing page — but then you only ever get the server-side layer.
//    The landing page is the trade-off for the richer client-side data.
// -----------------------------------------------------------------------------
app.get("/t/:code", (req, res) => {
  const db = loadDB();
  const link = db.links[req.params.code];
  if (!link) return res.status(404).send("Unknown link.");

  // --- (a) server-side capture: what the HTTP request itself reveals ---
  const ua = new UAParser(req.headers["user-agent"] || "");
  const parsed = ua.getResult();
  const hit = {
    id: nanoid(10),
    code: link.code,
    at: new Date().toISOString(),
    // Network — IP comes from the socket or the X-Forwarded-For header if
    // you're behind a proxy/tunnel. Geo/ISP would require an IP lookup service
    // (e.g. ipinfo.io); we leave a placeholder to keep this dependency-free.
    ip: req.ip,
    forwardedFor: req.headers["x-forwarded-for"] || null,
    // Browser / device (parsed from User-Agent)
    userAgent: req.headers["user-agent"] || null,
    browser: `${parsed.browser.name || "?"} ${parsed.browser.version || ""}`.trim(),
    os: `${parsed.os.name || "?"} ${parsed.os.version || ""}`.trim(),
    deviceType: parsed.device.type || "desktop",
    deviceVendor: parsed.device.vendor || null,
    // Request context
    language: req.headers["accept-language"] || null,
    referer: req.headers["referer"] || null,
    // client-side fields get filled in by /api/collect below
    client: null,
    destination: link.destination,
  };
  db.hits.push(hit);
  saveDB(db);

  // --- (b) serve the collector page, passing the hit id + destination ---
  const html = fs
    .readFileSync(path.join(__dirname, "public", "collect.html"), "utf8")
    .replace("__HIT_ID__", hit.id)
    .replace("__DESTINATION__", encodeURIComponent(link.destination));
  res.set("Content-Type", "text/html").send(html);
});

// -----------------------------------------------------------------------------
// 3) CLIENT-SIDE data comes back here, keyed by the hit id.
//    POST /api/collect  { hitId, client:{...} }
// -----------------------------------------------------------------------------
app.post("/api/collect", (req, res) => {
  const { hitId, client } = req.body;
  const db = loadDB();
  const hit = db.hits.find((h) => h.id === hitId);
  if (hit) {
    hit.client = client || {};
    saveDB(db);
  }
  res.json({ ok: true });
});

// Root -> dashboard
app.get("/", (req, res) => res.redirect("/app/"));

app.listen(PORT, () => {
  console.log(`\n  linktrack running`);
  console.log(`  Dashboard:  ${PUBLIC_BASE}/app/`);
  console.log(`  Make a link, share the /t/<code> URL, watch hits appear.\n`);
});
