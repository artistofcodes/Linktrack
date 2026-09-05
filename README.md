# linktrack — a prototype click-analytics service

Generate a tracking link → when someone opens it, the server logs what their
request reveals + (optionally) richer client-side details → the visitor is
forwarded to a real destination → you watch hits on a dashboard.

This is the same mechanism behind URL shorteners and marketing link trackers.
It's a **learning prototype**, not production software.

## Run it

```bash
npm install
npm start
# open http://localhost:3000/app/
```

1. Enter a destination URL (e.g. `https://example.com`) → **Create link**.
2. Copy the generated `http://localhost:3000/t/<code>` link and open it in
   another browser/device.
3. The hit appears on the dashboard (auto-refreshes every 4s).

To test from a phone or another machine, expose it with a tunnel and set the
public base so links are clickable:

```bash
# in another terminal:  cloudflared tunnel --url http://localhost:3000
PUBLIC_BASE="https://your-tunnel-url" npm start
```

## What gets captured

| Layer | Fields | Reliability |
|---|---|---|
| **Server** (HTTP request) | IP, User-Agent → browser/OS/device, Accept-Language, Referer, time | Always, even with JS off |
| **Client** (JS on landing page) | screen, viewport, timezone, languages, CPU cores, device memory, touch, **GPU (WebGL)**, network hint | Only if JS runs; blockable |

**Not obtainable** (common misconceptions): exact address/name from IP (city-level
at best, broken by VPN/mobile carriers), MAC/IMEI, "true" device ID. GPS/camera/mic
would each require an explicit browser permission prompt — deliberately not requested.

## Files

- `server.js` — link creation, the `/t/:code` tracking endpoint, the collect API, JSON storage
- `public/collect.html` — the landing page that runs client-side collection then redirects
- `public/index.html` — the dashboard
- `data.json` — created at runtime; your links + hits

## If you take this further

- **Geo/ISP**: send the IP to a lookup service (ipinfo.io, MaxMind, ipapi) — add it in `server.js` where the `ip` field is set.
- **Storage**: swap the JSON file for SQLite/Postgres once you have real volume.
- **Fingerprint hash**: hash the client fields to recognise repeat visitors.

## Responsible use — this matters

IP + fingerprint is **personal data** under India's DPDP Act 2023 (and GDPR for
EU visitors). A legitimate deployment:

- Has a clear purpose (analytics for *your own* campaigns/links), not covert
  tracking or deanonymising a specific person.
- Discloses tracking (a privacy notice / visible redirect) — the `collect.html`
  spinner is a placeholder; a consent-first version shows a notice there.
- Doesn't collect more than it needs, and secures/retention-limits what it stores.

Don't use it to secretly grab a named individual's location — that's what
crosses from analytics into surveillance, and it's what the law targets.
