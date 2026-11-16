// Private stats page: https://youroptions.homes/stats
//
// Reads YourOptions.homes activity back out of Follow Up Boss (page views from personal links and
// requests) and shows who visited, what they read and when. Protected by the STATS_PASSWORD
// environment variable in Netlify; the browser asks for it (any user name works).
//
// Optional: ?days=14 to look further back (default 7, max 60).

const FUB = "https://api.followupboss.com/v1";
const SITE = "YourOptions.homes";
const TZ = "America/Los_Angeles";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (d) => new Date(d).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function unauthorized() {
  return new Response("Password required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="YourOptions stats"' } });
}

export default async (req) => {
  const password = process.env.STATS_PASSWORD;
  const key = process.env.FUB_API_KEY;
  if (!password) return new Response("Set STATS_PASSWORD in Netlify to turn on this page.", { status: 503 });

  const auth = req.headers.get("authorization") || "";
  const given = auth.startsWith("Basic ") ? atob(auth.slice(6)).split(":").slice(1).join(":") : "";
  if (given !== password) return unauthorized();
  if (!key) return new Response("FUB_API_KEY is not set.", { status: 503 });

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "7", 10) || 7, 1), 60);
  const since = Date.now() - days * 86400000;
  const headers = { Authorization: "Basic " + btoa(key + ":"), "X-System": "YourOptionsHomes" };

  // Pull recent events newest-first and keep the ones from this site.
  const events = [];
  for (const type of ["Viewed Page", "Seller Inquiry"]) {
    for (let offset = 0; offset < 3000; offset += 100) {
      const r = await fetch(`${FUB}/events?type=${encodeURIComponent(type)}&sort=-created&limit=100&offset=${offset}`, { headers });
      if (!r.ok) break;
      const batch = (await r.json()).events || [];
      for (const e of batch) {
        if (new Date(e.created).getTime() < since) continue;
        if (String(e.source || "").toLowerCase() !== SITE.toLowerCase()) continue;
        if (e.type !== type) continue;
        events.push(e);
      }
      if (batch.length < 100 || new Date(batch[batch.length - 1].created).getTime() < since) break;
    }
  }

  // Group by person.
  const people = new Map();
  for (const e of events) {
    if (!e.personId) continue;
    const p = people.get(e.personId) || { id: e.personId, views: [], requests: [] };
    if (e.type === "Seller Inquiry") p.requests.push(e);
    else p.views.push(e);
    people.set(e.personId, p);
  }

  // Look up names (a few at a time).
  const ids = [...people.keys()];
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(
      ids.slice(i, i + 8).map(async (id) => {
        const r = await fetch(`${FUB}/people/${id}?fields=firstName,lastName,name,tags`, { headers });
        if (r.ok) {
          const j = await r.json();
          const p = people.get(id);
          p.name = j.name || [j.firstName, j.lastName].filter(Boolean).join(" ");
          p.tags = (j.tags || []).filter((t) => /^YO /.test(t));
        }
      })
    );
  }

  const rows = [...people.values()].map((p) => {
    const all = [...p.views, ...p.requests].map((e) => new Date(e.created).getTime());
    return { ...p, last: Math.max(...all), first: Math.min(...all) };
  });
  rows.sort((a, b) => b.requests.length - a.requests.length || b.views.length - a.views.length || b.last - a.last);

  const pageCounts = {};
  for (const e of events.filter((e) => e.type === "Viewed Page")) {
    const t = String(e.pageTitle || "").replace(/^YourOptions\.homes:\s*/, "") || "(unknown page)";
    pageCounts[t] = (pageCounts[t] || 0) + 1;
  }
  const pages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]);
  const totalViews = events.filter((e) => e.type === "Viewed Page").length;
  const totalRequests = events.filter((e) => e.type === "Seller Inquiry").length;

  const personRows = rows
    .map((p) => {
      const seen = [...new Set(p.views.map((e) => String(e.pageTitle || "").replace(/^YourOptions\.homes:\s*/, "")))];
      return `<tr>
        <td><a href="https://marc-samulewicz.followupboss.com/2/people/view/${esc(p.id)}" target="_blank" rel="noopener">${esc(p.name || "Contact " + p.id)}</a>
          ${p.tags && p.tags.length ? `<div class="tags">${p.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}</td>
        <td class="num">${p.views.length}</td>
        <td class="num">${p.requests.length ? `<b class="req">${p.requests.length}</b>` : "—"}</td>
        <td>${seen.map(esc).join("<br>") || "—"}</td>
        <td class="when">${fmt(p.last)}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>YourOptions stats</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap">
<style>
:root{--bg:#F5F7F9;--card:#fff;--fg:#1A1A1A;--muted:#555F69;--line:#D3DCE4;--orange:#F16623;--slate:#6A8399}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 Montserrat,Arial,sans-serif;padding:24px max(16px,env(safe-area-inset-left))}
main{max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
h1{margin:0;font-size:1.6rem}h2{margin:0 0 10px;font-size:1.1rem}.sub{color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--line);padding:16px}.tile b{display:block;font-size:2rem;color:var(--orange)}
.card{background:var(--card);border:1px solid var(--line);padding:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.num{text-align:right;font-variant-numeric:tabular-nums}
.when{white-space:nowrap;color:var(--muted)}.req{color:var(--orange)}a{color:var(--slate);font-weight:600}
.tags span{display:inline-block;font-size:.72rem;background:var(--bg);border:1px solid var(--line);padding:1px 6px;margin:3px 4px 0 0}
.days a{margin-right:12px}
</style></head><body><main>
<div><h1>YourOptions.homes visitors</h1><p class="sub">Last ${days} days · personal-link visits and requests recorded in Follow Up Boss · ${esc(fmt(Date.now()))}</p>
<p class="days">Show: <a href="?days=1">1 day</a><a href="?days=3">3 days</a><a href="?days=7">7 days</a><a href="?days=30">30 days</a></p></div>
<div class="tiles">
  <div class="tile"><b>${rows.length}</b>people visited</div>
  <div class="tile"><b>${totalViews}</b>pages viewed</div>
  <div class="tile"><b>${totalRequests}</b>requests sent</div>
</div>
<div class="card"><h2>Who visited</h2>
${rows.length ? `<table><thead><tr><th>Person</th><th class="num">Pages</th><th class="num">Requests</th><th>What they read</th><th>Last visit</th></tr></thead><tbody>${personRows}</tbody></table>` : `<p class="sub">No personal-link visits in this period yet.</p>`}
</div>
<div class="card"><h2>Most-read pages</h2>
${pages.length ? `<table><thead><tr><th>Page</th><th class="num">Views</th></tr></thead><tbody>${pages.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td></tr>`).join("")}</tbody></table>` : `<p class="sub">No page views yet.</p>`}
</div>
<p class="sub">Visitors without a personal link (for example from a postcard QR code) appear here only once they send a request.</p>
</main></body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
};

export const config = { path: "/stats" };
