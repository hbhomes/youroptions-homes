// Sends visitor activity from YourOptions.homes to Follow Up Boss.
//
// Set FUB_API_KEY in Netlify (Project configuration → Environment variables).
// Without it, activity is only written to the Netlify function log.
//
// What goes to Follow Up Boss:
//   • "Send me more information" and "Have Marc call me" → a Seller Inquiry event, source
//     YourOptions.homes, tagged YourOptions.homes / YO Topic: … / YO Wants: … / YO Mailer: …
//     Follow Up Boss creates or updates the contact, runs the source's Lead Flow, and notifies Marc.
//   • Page views from a personal link (youroptions.homes/?p=<FUB person id>) → a Viewed Page
//     event, shown under Website Activity on that contact.
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

  const slug = /^[a-z0-9-]{1,40}$/.test(String(d.slug || "")) ? d.slug : "";
  const pageUrl = `https://youroptions.homes/${slug ? "#" + slug : ""}`;
  // Lets Follow Up Boss report leads by mailer: Source = YourOptions.homes, Medium = direct mail or website.
  const campaignInfo = { source: SITE, medium: campaign ? "direct mail" : "website", ...(campaign ? { campaign } : {}) };

  const postEvent = async (input) => {
    const { fallbackPerson, ...event } = input;
    let r = await fetch(`${FUB}/events`, { method: "POST", headers: fubHeaders(key), body: JSON.stringify(event) });
    // A personal link with an unknown or deleted contact id: send again without it so the lead isn't lost.
    if (r.status === 404 && event.person && event.person.id && fallbackPerson) {
      event.person = fallbackPerson;
      r = await fetch(`${FUB}/events`, { method: "POST", headers: fubHeaders(key), body: JSON.stringify(event) });
    }
    const text = await r.text();
    if (!r.ok) console.error("FUB event failed", r.status, text);
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: r.status, json, usedId: Boolean(event.person && event.person.id) };
  };

  const api = (path, method = "GET", body) =>
    fetch(`${FUB}${path}`, { method, headers: fubHeaders(key), ...(body ? { body: JSON.stringify(body) } : {}) });

  // Find the Follow Up Boss contact an event landed on.
  const findPersonId = async (res, fields) => {
    const j = res.json || {};
    const direct = j.personId || (j.person && j.person.id) || (j.firstName !== undefined && j.id);
    if (direct) return Number(direct);
    const lookups = [];
    if (fields.emails) lookups.push(`email=${encodeURIComponent(fields.emails[0].value)}`);
    if (fields.phones) lookups.push(`phone=${encodeURIComponent(fields.phones[0].value)}`);
    for (const q of lookups) {
      const r = await api(`/people?${q}&limit=1&sort=-created`);
      if (r.ok) {
        const people = (await r.json()).people || [];
        if (people[0]) return Number(people[0].id);
      }
    }
    return null;
  };

  try {
    if (type === "view") {
      // Known contacts (personal link): shows under Website Activity on their Follow Up Boss profile.
      if (personId) {
        await postEvent({
          source: SITE,
          system: SYSTEM,
          type: "Viewed Page",
          pageTitle: `${SITE}: ${page}`,
          pageUrl,
          campaign: campaignInfo,
          person: { id: Number(personId) },
        });
      }
      return new Response(null, { status: 204 });
    }

    if (type === "request" || type === "callback") {
      const name = clip(d.name, 100);
      const contact = clip(d.contact, 200);
      const topic = clip(d.topic, 100);
      const how = clip(d.how, 30);
      if (!name || !contact) return new Response("Missing name or contact", { status: 400 });

      const Topic = topic ? topic.charAt(0).toUpperCase() + topic.slice(1) : "";
      const ask =
        type === "callback"
          ? `Asked Marc to CALL THEM while reading ${page}.`
          : `Wants more information about ${topic}. Send by ${how}.`;
      const message = [
        ask,
        `Contact given: ${contact}`,
        campaign ? `Came from mailer: ${campaign}` : "Came from: the website (no mailer code)",
        history.length ? `Pages read: ${history.join(" → ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      // Tags: one master tag for every YourOptions lead, then what they asked about and how to follow up.
      const tags = ["YourOptions.homes"];
      if (Topic) tags.push(`YO Topic: ${Topic}`);
      tags.push(type === "callback" ? "YO Wants: Call back" : `YO Wants: ${how.charAt(0).toUpperCase() + how.slice(1)}`);
      if (campaign) tags.push(`YO Mailer: ${campaign}`);

      const newPerson = { ...splitName(name), ...contactFields(contact), source: SITE, sourceUrl: pageUrl, tags };
      // Personal link: attach to the existing contact without overwriting their name or original source
      // (a relative may fill in the form). If that contact no longer exists, create a new lead instead.
      const person = personId ? { id: Number(personId), tags } : newPerson;

      const res = await postEvent({
        source: SITE,
        system: SYSTEM,
        // Seller Inquiry: these are homeowners, so Follow Up Boss files them as sellers, not buyers.
        type: "Seller Inquiry",
        message,
        pageTitle: `${SITE}: ${page}`,
        pageUrl,
        campaign: campaignInfo,
        person,
        fallbackPerson: personId ? newPerson : undefined,
      });

      // 201 = Follow Up Boss created a new contact; 200 = it matched someone already in the database.
      // 204 = the YourOptions.homes lead flow is archived, so do nothing more.
      if (res.status === 200 || res.status === 201) {
        const isNew = res.status === 201 && !res.usedId;
        const id = res.usedId ? Number(personId) : await findPersonId(res, newPerson);
        if (id) {
          // Segment tag, added after the lead exists so "Tag Added" automations fire reliably.
          // New leads → the YO nurture emails. Existing contacts → no automated emails, only Marc's task.
          const segment = isNew ? "YO New Lead" : "YO Existing Contact";
          const t = await api(`/people/${id}?mergeTags=true`, "PUT", { tags: [segment] });
          if (!t.ok) console.error("FUB tag failed", t.status, await t.text());

          // A task for Marc on every request, saying exactly what to do.
          const who = isNew ? name : `${name} (EXISTING CONTACT: check their history and other automations first)`;
          let task, taskType;
          if (type === "callback") { task = `CALL BACK within 1 hour: ${who}`; taskType = "Call"; }
          else if (how === "postal mail") { task = `Mail printed info on ${topic} + handwritten card: ${who}`; taskType = "Follow Up"; }
          else if (how === "phone call") { task = `Call about ${topic}: ${who}`; taskType = "Call"; }
          else { task = `Email info on ${topic}: ${who}`; taskType = "Email"; }
          const due = new Date(Date.now() + (type === "callback" ? 1 : 3) * 3600 * 1000).toISOString();
          const k = await api("/tasks", "POST", { personId: id, name: `YourOptions: ${task}`.slice(0, 250), type: taskType, dueDateTime: due });
          if (!k.ok) console.error("FUB task failed", k.status, await k.text());
        } else {
          console.error("Could not find the Follow Up Boss contact for this request");
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response("Unknown type", { status: 400 });
  } catch (err) {
    console.error("track error", err);
    return new Response(null, { status: 204 });
  }
};

export const config = { path: "/api/track" };
