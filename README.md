# Moomin Mug Collection

A full-stack app for photographing, identifying, and tracking a Moomin mug
collection — and getting **push-notified when a wishlisted mug shows up for
sale**.

- **Snap-to-add** — photograph one mug; Gemini identifies the character,
  series, year, edition, reads its condition, and estimates its value.
- **Shelf scan** — one photo of a shelf → detect several mugs → review and
  batch-add.
- **Duplicate guard** — flags mugs you probably already own.
- **Gap finder** — list a series' catalogue and wishlist what's missing.
- **Deal alerts** — an hourly job searches marketplaces for wishlisted mugs
  and sends a web-push notification when new listings appear. Each wishlist
  card also has an on-demand "Deals" search.

### Marketplace & retailer sources

| Source | How it's searched |
| --- | --- |
| Tradera | Official v3 SOAP `SearchService` (structured — real price/image/id), when `TRADERA_APP_ID`/`TRADERA_APP_KEY` are set |
| eBay | Browse API (structured — real price/image), when `EBAY_CLIENT_ID`/`SECRET` are set |
| Blocket, Facebook Marketplace | Gemini Google-Search grounding, restricted per domain |
| Arabia, Cervera (retailers) | Gemini Google-Search grounding, restricted per domain |

Tradera and eBay use their official APIs (structured, reliable). The remaining
sites have no public listing API, so they're searched via Gemini web search
rather than scraping (which their terms forbid). Grounded coverage depends on
what Google has indexed — good for Blocket / Cervera / Arabia, thin for
login-gated Facebook Marketplace. Add or remove grounded sites in
`lib/marketplaces.ts` (`SITE_SOURCES`), or add another structured API source
alongside `lib/tradera.ts` / `lib/ebay.ts`; the notifier and UI pick them up
automatically.

## Stack

Next.js (App Router) · Postgres · Gemini (vision + grounded search) ·
eBay Browse API · Web Push (VAPID) · Vercel Cron. Deploys to Vercel, or any
Node host with an external scheduler hitting the cron endpoint.

```
app/
  page.jsx                       # the whole UI (client)
  api/
    mugs/…                       # CRUD
    identify · shelf-scan        # Gemini vision
    gaps                         # series catalogue
    deals                        # on-demand marketplace + web search
    push/{vapid,subscribe}       # web-push
    cron/check-wishlist          # scheduled notifier (Vercel Cron)
lib/  db · mugs · gemini · ebay · marketplaces · push · types
public/  sw.js · manifest.json · icon.svg
```

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Database** — any Postgres (Neon / Supabase / Vercel Postgres). Put the
   connection string in `DATABASE_URL`. Tables are created automatically on
   first request.

3. **Environment** — copy `.env.example` to `.env.local` and fill in:
   - `GEMINI_API_KEY` — from https://aistudio.google.com/apikey (required for
     identification, value estimates, and gap finder).
   - `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` — optional, from
     https://developer.ebay.com. Adds eBay as a structured source (real
     price/image). Not required: with `GEMINI_API_KEY` set, the notifier
     already polls Tradera, Blocket, Facebook Marketplace, Arabia and Cervera.
   - VAPID keys for push:
     ```bash
     npm run gen-vapid   # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
     ```
   - `DEFAULT_CURRENCY`, `DEFAULT_REGION`, `EBAY_MARKETPLACE_ID` as you like.

4. **Run**
   ```bash
   npm run dev        # http://localhost:3000
   ```

## Deploy (Vercel)

1. Import the repo into Vercel.
2. Add all env vars from `.env.example` in the project settings. Set
   `CRON_SECRET` to any random string — Vercel Cron sends it automatically so
   only the scheduler can trigger the notifier.
3. `vercel.json` schedules `GET /api/cron/check-wishlist` once a day (07:00
   UTC). Vercel's **Hobby plan only allows daily crons** — a more frequent
   schedule makes the deployment fail. For hourly checks, either upgrade to
   Pro, or keep the daily Vercel cron and additionally ping the endpoint from
   a free external scheduler (GitHub Actions / cron-job.org) hitting
   `https://<domain>/api/cron/check-wishlist` with `Authorization: Bearer $CRON_SECRET`.
4. Open the app, add a wishlist mug, and hit **🔔 Enable notifications**.

To notify on other marketplaces, add a source in `lib/marketplaces.ts`
(implement the `Listing` shape) — the cron and the UI pick it up automatically.

## Clearing eBay's "Non Compliant" status

Every production eBay app must expose a **Marketplace Account Deletion/Closure
notification endpoint**, or it shows as *Non Compliant* and Browse calls can be
throttled. This app ships that endpoint at **`/api/ebay/deletion`** — it stores
no eBay user data, so it just answers eBay's ownership challenge and `200`s any
deletion notice.

To make the app compliant:

1. **Deploy** so you have a public HTTPS URL (e.g.
   `https://muminmuggar.vercel.app`).
2. Pick a **verification token** — 32–80 chars, `[A-Za-z0-9_-]` — and set it as
   `EBAY_VERIFICATION_TOKEN` in your Vercel env, then redeploy.
3. In eBay Developer Portal → **Alerts & Notifications** →
   *Marketplace Account Deletion*:
   - **Endpoint:** `https://<your-domain>/api/ebay/deletion`
   - **Verification token:** the same value as `EBAY_VERIFICATION_TOKEN`
   - Click **Save**. eBay immediately calls the endpoint's challenge; if it
     validates, the status flips to Compliant.
4. **Send Test Notification** should return success.

(If you register the endpoint at a path other than the default, also set
`EBAY_DELETION_ENDPOINT` to that exact URL so the challenge hash matches.)

## Notes

- Push notifications require HTTPS (works on Vercel; on localhost use
  `http://localhost` which browsers treat as secure).
- Photos are stored as downscaled data URLs in Postgres — fine for a personal
  collection; swap `photo_url` for a blob store if it ever grows large.
