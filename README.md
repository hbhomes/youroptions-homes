# YourOptions.homes

*Your Home, Your Options*: a planning guide for long-time Huntington Beach homeowners, from Marc Samulewicz (hb.homes, Seven Gables Real Estate, DRE #02336405).

## What's here

| Path | What it is |
|---|---|
| `public/index.html` | The whole site: Parts 1–5 and the drill-down topic pages, one page with `#` links (`#part-1` … `#part-5`, `#step-up`, `#living-trust`, …) |
| `public/logo.png`, `favicon.png`, `apple-touch-icon.png` | hb.homes logo and icons |
| `netlify/functions/track.mjs` | Sends requests and personal-link page views to Follow Up Boss (`/api/track`) |
| `netlify.toml` | Netlify settings: publish `public/`, functions in `netlify/functions/` |

## Links to use

- QR code / mailer: `https://youroptions.homes/` (add `?c=CODE` to tell mailers apart, e.g. `?c=nov-mailer`)
- Straight to a topic: `https://youroptions.homes/#living-trust`
- Personal link for one contact: `https://youroptions.homes/?p=FUB_PERSON_ID` (the number at the end of the contact's Follow Up Boss URL)

## Follow Up Boss

Set the environment variable `FUB_API_KEY` in Netlify (Project configuration → Environment variables), then redeploy.

- **Send me more information** and **Have Marc call me** create a *Seller Inquiry* in Follow Up Boss (source `YourOptions.homes`), tagged `YourOptions.homes`, `YO Topic: …`, `YO Wants: …` and `YO Mailer: …`, with the pages the visitor read.
- After each request the site tags the contact **YO New Lead** (new to Follow Up Boss) or **YO Existing Contact** (already in the database), and creates a task for Marc saying exactly what to do. Only *YO New Lead* should start the YO nurture automation.
- Visitors arriving on a personal link show up under **Website Activity** on their contact (a *Viewed Page* event per part or topic).

## Private stats page

`https://youroptions.homes/stats` lists everyone who visited through a personal link (and every request) in the last 7 days, read back from Follow Up Boss: who, how many pages, what they read, and when. Add `?days=30` to look further back.

Set `STATS_PASSWORD` in Netlify (Project configuration → Environment variables, marked secret) and redeploy. The browser asks for it; any user name works.
