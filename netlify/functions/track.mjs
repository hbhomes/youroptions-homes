// Sends visitor activity from YourOptions.homes to Follow Up Boss.
//
// Set FUB_API_KEY in Netlify (Project configuration → Environment variables).
// Without it, activity is only written to the Netlify function log.
//
// What goes to Follow Up Boss:
//   • "Send me more information" and "Have Marc call me" → a General Inquiry event.
//     Follow Up Boss creates or updates the contact and notifies Marc.
//   • Page views from a personal link (youroptions.homes/?p=<FUB person id>) → a note
//     on that contact's timeline, e.g. "Opened Part 4: Capital gains".
//   • Page views from anonymous visitors are logged only; their reading history is
//     attached to any request they later send.

const FUB = "https://api.followupboss.com/v1";
const SYSTEM = "YourOptionsHomes";
const SITE = "YourOptions.homes";

const clip = (v, n = 300) => (typeof v === "string" ? v.slice(0, n).trim() : "");

function fubHeaders(key) {
  return {
    "Content-Type": "application/json",
    Authorization: "Basic " + btoa(key + ":"),
    "X-System": SYSTEM,
  };
}

function splitName(full) {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] || "Website visitor" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function contactFields(contact) {
  const out = {};
  const email = contact.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (email) out.emails = [{ value: email[0] }];
  const digits = contact.replace(/\D/g, "");
  if (!email && digits.length >= 10 && digits.length <= 11) out.phones = [{ value: contact }];
  return out;
}

async function addNote(key, personId, subject, body) {
  const r = await fetch(`${FUB}/notes`, {
    method: "POST",
    headers: fubHeaders(key),
    body: JSON.stringify({ personId: Number(personId), subject, body, isHtml: false }),
  });
  if (!r.ok) console.error("FUB note failed", r.status, await r.text());
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let d;
  try {
    d = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const type = clip(d.type, 20);
  const page = clip(d.page, 120);
  const personId = /^\d{1,12}$/.test(String(d.person || "")) ? String(d.person) : null;
  const campaign = clip(d.campaign, 60);
  const history = Array.isArray(d.history) ? d.history.slice(-25).map((h) => clip(h, 120)).filter(Boolean) : [];
  const key = process.env.FUB_API_KEY;

  console.log(JSON.stringify({ type, page, personId, campaign }));
  if (!key) return new Response(null, { status: 204 });

  try {
    if (type === "view") {
      if (personId) await addNote(key, personId, `${SITE}: page viewed`, `Opened ${page}`);
      return new Response(null, { status: 204 });
    }

    if (type === "request" || type === "callback") {
      const name = clip(d.name, 100);
      const contact = clip(d.contact, 200);
      const topic = clip(d.topic, 100);
      const how = clip(d.how, 30);
      if (!name || !contact) return new Response("Missing name or contact", { status: 400 });

      const headline =
        type === "callback"
          ? `${name} asked Marc to call them while reading ${page}.`
          : `${name} wants more information about ${topic}, by ${how}.`;
      const message = [
        headline,
        `Contact given: ${contact}`,
        campaign ? `Mailer code: ${campaign}` : "",
        history.length ? `Pages read on ${SITE}: ${history.join(" → ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const tags = ["YourOptions.homes"];
      if (topic) tags.push(`YO: ${topic}`);
      if (type === "callback") tags.push("YO: call request");

      const event = {
        source: SITE,
        system: SYSTEM,
        type: "General Inquiry",
        message,
        description: headline,
        pageTitle: page,
        pageUrl: "https://youroptions.homes/",
        person: { ...splitName(name), ...contactFields(contact), tags },
      };

      const r = await fetch(`${FUB}/events`, { method: "POST", headers: fubHeaders(key), body: JSON.stringify(event) });
      if (!r.ok) console.error("FUB event failed", r.status, await r.text());
      if (personId) await addNote(key, personId, `${SITE}: request`, message);
      return new Response(null, { status: 204 });
    }

    return new Response("Unknown type", { status: 400 });
  } catch (err) {
    console.error("track error", err);
    return new Response(null, { status: 204 });
  }
};

export const config = { path: "/api/track" };
