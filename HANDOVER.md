# Handover — Moomin Mug Collection app ("muminmuggar")

> **Read this first in every new session.** It is the living state of the project.
> **Update it whenever you finish work** — see [Maintaining this document](#maintaining-this-document)
> at the bottom. `AGENTS.md` (auto-loaded) points here.

---

## 1. What this is

A full-stack app for photographing, identifying and tracking a Moomin mug
collection, with push notifications when wishlisted mugs appear for sale.

- **Repo:** `git@github.com:kmja/muminmuggar.git` (branch `main`, deploy = Vercel)
- **Local path:** `/Users/karlandersson/Documents/Default Project`
- **Current version:** **1.45.1** (keep in sync with `lib/version.js`)
- **Stack:** Next.js 14 (App Router) · Postgres · Gemini (vision) · Tradera API ·
  Web Push (VAPID) · Vercel Cron
- **`gh` CLI is NOT installed.** Git over SSH works; fetch/push work fine.

---

## 2. Workflow (from AGENTS.md)

- After completing a change, **commit and push to `main`** (no need to ask).
- Commit style: concise summary ending with the version, e.g.
  `Rework the add-mug dialog (v1.14.0)`.
- **Bump the version on every push** in all three places:
  - `lib/version.js` (`APP_VERSION`) — edit by hand
  - `package.json` (`version`)
  - `package-lock.json` (root `version`, both occurrences)
  - Tip: `npm version <x.y.z> --no-git-tag-version` updates package.json + lock;
    then edit `lib/version.js`.
- Minor bump for features, patch for small fixes.
- Verify before pushing: `npx tsc --noEmit` and `npm run build`.
- **Never commit secrets.** `.env.local` is gitignored.

---

## 3. Architecture map

```
app/
  page.jsx            # the ENTIRE client UI (~1.5k lines). App + components.
  layout.tsx          # metadata + viewport (interactiveWidget: overlays-content)
  globals.css         # all styling (fixed shell, header wave, drawer, deal rows…)
  providers.tsx       # next-auth SessionProvider + theme
  label/page.jsx      # on-site labelling tool
  api/
    mugs/…            # CRUD (+ [id] PATCH/DELETE)
    identify, shelf-scan   # Gemini vision
    gaps, deals            # series catalogue / marketplace search
    catalog, catalog/list  # product-image catalogue
    mug-image, mug-details # image backfill / collector details
    push/{vapid,subscribe,test}
    cron/check-wishlist    # scheduled notifier
    tradera                # diagnostics: live Tradera search
    match-feedback, label-images, labels, finetune, model
    health, claim, auth/[...nextauth]
lib/
  db.ts               # schema (auto-migrates) + rowToMug
  mugs.ts             # mug CRUD + column mapping
  catalog.ts          # master-catalogue matching (names, images, values)
  marketplaces.ts     # searchMarketplaces + Tradera relevance ranking
  tradera.ts          # Tradera SOAP v3 client (WSDL-accurate)
  types.ts            # Mug, Listing, AiMug
  session.ts, auth.ts # owner resolution (Google email or anon:device)
  push.ts             # web-push send + prune
  gemini.ts           # vision + grounded search (grounded search currently UNUSED)
  ebay.ts             # eBay Browse API (currently UNUSED)
  i18n.js             # sv (default) + en strings
  search.js           # Fuse.js wrapper (createSearch)
  master-catalog.json # 201 catalogue entries (source of truth for mugs)
  mug-details.json    # collector attributes per mug (from Mukify; see §6)
  probe-base.json     # synthetic normal equations for on-device fine-tuning
  version.js
scripts/
  build-mug-embeddings.mjs   # npm run build:embeddings
  enrich-mukify.mjs          # regenerate lib/mug-details.json from Mukify
  gen-vapid.mjs, add-swedish-names.mjs, label-tool.mjs, eval-labels.mjs
  lib/augment.mjs, lib/model.mjs
public/
  sw.js, manifest.json, mugs/*.webp (198 catalogue images), mug-embeddings.json
```

---

## 4. Features & current behaviour

- **Tabs:** Collection + Wishlist only. Swipeable (Embla); 16px gap between
  panels. Stats is a **header dialog**, not a tab. Shared search + filters sit
  **above** the tab strip (status filter only on Collection).
- **Header:** cream wavy bar. Right side: `Add` (desktop only), `Gaps` (desktop
  only), `Stats`, `Notifications`, account/language menu. On phones the add
  button is a fixed **FAB bottom-right**; there is no bottom nav.
- **Add flow:** from the add drawer (catalogue search `+`/`♥`) or photo
  identification → an **AddConfirmModal** collects optional status (owned /
  wishlist), purchase price + currency, condition and **"Etikett kvar"**, then
  saves. The shelf-scan batch flow is unchanged.
- **Edit dialog:** metadata-only — the mug identity (name/catalogue) is fixed.
  Editable: condition, acquired date, **etikett**, price/currency, favourite,
  photo, notes. Wishlist mugs get a one-tap **"Jag har köpt den"** (acquire)
  flow → owned.
- **Per-mug `hasTag`** ("etikett"): DB column `mugs.has_tag`, shown as a card
  badge and editable in the edit + add-confirm dialogs.
- **Marketplace search = Tradera only** for now. `lib/marketplaces.ts`
  (`searchMarketplaces`, `sourcesAvailable`) polls only Tradera; eBay + Gemini
  web search are implemented but **disabled**. Results are ranked by a
  catalogue-match score (`titleScore` / `bestCatalogMatch`) that drops hits
  naming a *different* mug (e.g. "Snusmumriken (rosa)" when searching Mug Rose).
- **Deals modal:** Tradera rows styled like the compact mug row; big current
  bid, secondary buy-now, muted deadline/bids line.
- **Notifications:** web push via VAPID. Cron `GET /api/cron/check-wishlist`
  (Vercel daily; supports `?owner=` and `?notify=0` for testing). Wishlist tab
  has a nudge to enable notifications; "Send test notification" in the dialog.
- **On-device recognition:** DINOv2-small + ridge probe in the browser
  (`lib/image-match.js`), top-4 picker, Gemini fallback. Rebuild with
  `npm run build:embeddings` after editing `lib/master-catalog.json` or
  `scripts/lib/augment.mjs`.

---

## 5. Catalogue (`lib/master-catalog.json`)

- 201 entries. Fields: `num, nameEn, nameSv, year, years, capacity, estLow,
  estHigh, estCur, image, norm`.
- **`num` matches Mukify's "Moomin Mug" serial number** (195/201 matched).
- Re-released mugs share a name, so each release carries a **year suffix**
  (`Mug Rose 1990` / `Mug Rose 2021`, `Snorkmaiden 2001/2013/2019/2024`, …).
  The one same-year size pair uses capacity (`Home at Last 0.3L` / `0.4L`).
  Keep names unique under folding (`ownKey`) or entries collapse in the UI.
- Names are stored **English** (they drive matching); Swedish is display-only
  via `nameSv`. Images live in `public/mugs/*.webp`.
- Changing this file requires `npm run build:embeddings`.

---

## 6. Collector attributes (`lib/mug-details.json`)

- Generated by `node scripts/enrich-mukify.mjs` from **Mukify's public GraphQL**
  (`https://database-prod.mukify.com/graphiql/`, read-only, no login).
- Keyed by `num`. Per mug: `aka, theme, special, stamps, stickers, characters,
  colors, itemDesigner, graphicDesigner, imagerySources, material, measurements`.
- Coverage: stamps 140, stickers 81, special editions 41 (of 195 matched).
- **Do NOT link to Mukify in the app** (user decision). URLs are stripped.
- Not yet surfaced in the UI — this is ready groundwork.

---

## 7. Environment & deploy

- `.env.local` (gitignored, exists locally) contains:
  `TRADERA_APP_ID`, `TRADERA_APP_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`. **No `DATABASE_URL` locally**, so local API routes that hit
  the DB won't work; Tradera/health diagnostics do.
- Vercel needs: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`,
  `GEMINI_API_KEY`, `TRADERA_APP_ID/KEY`, `VAPID_PUBLIC_KEY/PRIVATE_KEY`,
  `VAPID_SUBJECT`, `CRON_SECRET`. (No Vercel CLI installed — manual dashboard.)
- Diagnostics: `GET /api/health` (env flags), `GET /api/tradera?q=mumin%20mugg`
  (live search), `POST /api/push/test` (test push).

---

## 8. Open threads / TODO

- [ ] **Catalog completeness:** identify real mugs missing from *both* our
  catalog and Mukify (Mukify isn't complete either). Fill the 6 unmatched:
  `194 Moomin's Day 2026`, `201 Harp`, `204/205 Moomin Arabia Fall 2025 (+II)`,
  `206 Moomin Norway`, `207 Moomin's Day Blue`.
- [ ] **Surface collector details** (stamps/stickers/characters/colours/special)
  in the UI (edit dialog), **without** a Mukify link.
- [ ] **Mukify collection migration:** sharing links are a paid feature, so the
  share-link import is out. Options: a bookmarklet/console snippet the user runs
  while logged in, or a manual paste/import. Not built yet.
- [ ] **Production env:** add Tradera + VAPID keys in Vercel and redeploy; verify
  `/api/health`, enable notifications, send a test push.
- [ ] Consider showing the "etikett" flag on list rows too; further deal-row
  polish.

---

## 9. Conventions & gotchas

- `lib/search.js` `createSearch` must return the **original** items (it indexes
  them via `getFn`); wrapping them caused missing images/folded names.
- Tradera SOAP v3 `SearchService.Search` returns a **repeated `Items`** element
  (not `Items.SearchResultEntry`). Auth = `AuthenticationHeader` (AppId/AppKey).
  `orderBy=Relevance` is weak; we rank ourselves. Sandbox is retired.
- `interactiveWidget: "overlays-content"` in `app/layout.tsx` + vaul
  `repositionInputs={false}` + `90dvh` drawer = keyboard overlays instead of
  resizing/pushing the add sheet.
- i18n: add keys to **both** `sv` and `en` in `lib/i18n.js`.
- Secrets never in git; `.env.local` is ignored.

---

## 10. Maintaining this document

**Keep this file current — it is the memory between sessions.** After finishing
any meaningful work:

1. Update **§1 Current version**.
2. Update the relevant section(s) if architecture/behaviour/conventions changed.
3. Update **§8 Open threads** — remove done items, add new ones.
4. Add a dated line to the **Recent work log** below.
5. Commit it together with the code change.

### Recent work log

- **2026-09-17 · v1.45.1** — Added this handover doc; `AGENTS.md` now points here.
- **2026-09-17 · v1.45.0** — Added the add-confirmation dialog (status, price,
  condition, etikett); per-mug `hasTag` field; edit dialog made metadata-only.
  Removed Mukify links from the enriched data.
- **2026-09-17 · v1.44.0** — Added `scripts/enrich-mukify.mjs` +
  `lib/mug-details.json` (collector attributes from Mukify's public GraphQL).
- **2026-09-17 · v1.43.0** — Year-suffixed re-released mugs so every variant is
  selectable; rebuilt embeddings.
- **2026-09-17 · v1.42.0** — Search shows owned/wishlisted mugs (dimmed);
  renamed the 2018 Moomin's Day.
- **2026-09-17 · v1.41.0** — Tradera relevance ranking + cleaner deal rows.
- **2026-09-17 · v1.40.1** — Edit dialog cleanup (bigger identity, fewer
  fields, currency dropdown, "Spara").
- **2026-09-17 · v1.40.0** — Deal rows styled as mug rows; auction details
  (bid, buy-now, deadline, seller, condition).
- **2026-09-17 · v1.39.1 / v1.39.0** — Panel spacing; stats dialog; Tradera-only
  search; edit dialog metadata-only + acquire flow.
