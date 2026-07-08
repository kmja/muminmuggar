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
| eBay | Browse API (structured — real price/image), when credentials are set |
| Tradera, Blocket, Facebook Marketplace | Gemini Google-Search grounding, restricted per domain |
| Arabia, Cervera (retailers) | Gemini Google-Search grounding, restricted per domain |

None of the Swedish sites expose a public listing API, so those are searched
via Gemini web search rather than scraping (which their terms forbid).
Coverage depends on what Google has indexed — good for Tradera / Blocket /
Cervera / Arabia, thin for login-gated Facebook Marketplace. Add or remove
sources in `lib/marketplaces.ts` (`SITE_SOURCES`); the notifier and UI pick
them up automatically.

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
3. `vercel.json` already schedules `GET /api/cron/check-wishlist` hourly.
4. Open the app, add a wishlist mug, and hit **🔔 Enable notifications**.

To notify on other marketplaces, add a source in `lib/marketplaces.ts`
(implement the `Listing` shape) — the cron and the UI pick it up automatically.

## Notes

- Push notifications require HTTPS (works on Vercel; on localhost use
  `http://localhost` which browsers treat as secure).
- Photos are stored as downscaled data URLs in Postgres — fine for a personal
  collection; swap `photo_url` for a blob store if it ever grows large.
