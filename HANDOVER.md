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
- **Current version:** **1.66.1** (keep in sync with `lib/version.js`)
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
  globals.css         # all styling (fixed shell, header wave, dialogs, deal rows…)
  providers.tsx       # next-auth SessionProvider + theme
  label/page.jsx      # on-site labelling tool
  type/page.jsx       # type-scale playground (dev tool, noindex)
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
    import/mukify          # paste-import a Mukify export (bookmarklet) + extension
    import/mukify-shared   # import by public Mukify username (no login)
    import/token           # mint a connection token for the browser extension
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
  motion.js           # motion toolkit: useRipple, useFlip, animateGhost, useCountUp
  master-catalog.json # 201 catalogue entries (source of truth for mugs)
  mug-details.json    # collector attributes per mug (from Mukify; see §6)
  mukify-import.ts    # map a Mukify collection export → mugs (see §6)
  mukify-shared.ts    # import by public Mukify username (public shared API)
  import-token.ts     # HMAC import tokens for the browser extension
extension/            # Chrome/Edge MV3 add-on (one-click Mukify import)
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

- **Tabs:** Collection + Wishlist only, both with a `(n)` count. Swipeable (Embla); 16px gap between
  panels. Stats is a **header dialog**, not a tab. Shared search + filters sit
  **above** the tab strip (status filter only on Collection).
- **Header:** cream wavy bar. Right side: `Add` (desktop only), `Gaps` (desktop
  only), `Stats`, `Notifications`, account/language menu. On phones the add
  button is a fixed **FAB bottom-right**; there is no bottom nav.
- **Add flow:** tapping the add **FAB** (or the desktop header `Add`) opens a
  Material-style **context menu** (`AddMenu`, Radix Popover anchored to the
  trigger): Take photo · Choose image · Search the catalogue. A photo is
  processed by the centred **add dialog** (`AddMugModal`); the catalogue opens
  it on the browse stage. **`♥` (wishlist) skips the confirm** — the heart pops
  and a toast confirms. **`+` (owned)** opens the raised **AddConfirmModal** —
  grouped into **Förvärv** (acquisition date, defaulted to today; paid +
  currency) and **Egenskaper** (condition, **"Etikett kvar"**, notes) — with
  **Save** (primary, closes the add dialog), **Save and add more** (secondary,
  keeps it open) and **Cancel** (tertiary). The add dialog's own action is a
  single secondary **Close**; stages (browse/busy/match/review) cross-fade in.
  The shelf-scan batch review keeps its Rescan / Add actions. (`vaul` removed.)
- **Back gesture:** swiping in from the screen edge (or the Android back button)
  closes the top-most open dialog; with none open it falls through to the browser
  default. Implemented by `useBackToClose` (sentinel history entries).
- **Empty state (Collection):** a mug-shelf illustration (`MugShelf`, accent
  colour) plus three purple actions — **Take photo** (filled `primary accent`),
  **Choose photo** and **Search the catalogue** (outlined `ghost accent`). The
  camera/file inputs live in `App` (`camRef`/`fileRef`, `pickPhoto`) and are
  shared by the FAB menu and the empty state.
- **List view:** no favourite badge on the thumbnail; the row's star button turns
  gold when active (matching the grid card). The row's **name uses `h3`**.
- **Delete:** no delete button on list/grid items — it lives in the **edit
  dialog** and as a **row swipe** in the tab's over-scroll direction: **right on
  Collection, left on Wishlist** (`deleteDir`). The opposite direction stays with
  Embla for tab switching (which still follows the finger live). `MugRow` uses
  **native** touch listeners (React's are delegated too high) and
  `stopPropagation`s the delete direction so Embla doesn't over-scroll.
- Deletes are **soft**: the row leaves at once, the server call is deferred 6 s
  (`UNDO_MS`), and a stacked Sonner toast offers **Undo** (restores from
  `pendingDeletes`). A `pagehide` handler commits pending deletes.
- **`/type` (dev tool):** a noindex playground. Sliders tune the type steps,
  **5 icon sizes** and **5 font weights**; per-atom class + weight pickers; and
  live **composites** (list
  view, grid view, search + filters, add dialog, edit dialog, add menu, empty
  state, deal row, stats) that follow the atom picks. "Copy spec" yields a text
  spec the user can send to request type/icon changes.
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
- **Motion (`lib/motion.js` + the "Motion" section in `globals.css`):** every
  control dips fast (scale .92 + inset shadow) and springs back with a bounce,
  plus a ripple on press (`useRipple`, delegated `pointerdown`); list
  items FLIP when the set/order changes (`useFlip`, WAAPI); a deleted mug fades
  out via a fixed clone (`animateGhost`) while the rest glide up; the favourite
  star pops + emits a ring; the tab underline and the AddConfirm status thumb
  slide; stats count up and bars grow; dialogs scale/fade; filters expand.
  Everything is off under `prefers-reduced-motion`. FLIP is opt-in per element
  via `data-flip-key`; the delete ghost queries `[data-mug-id]`.

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

### Collection migration from Mukify

- Account menu → **"Importera från Mukify"** opens `ImportDialog`: a **bookmarklet**
  (draggable on desktop; on touch/PWA a **"Copy code"** button plus steps to paste
  it into a bookmark, since there's no bookmarks bar) + a paste box. The user runs
  the bookmarklet **on mukify.com** (their session never leaves their browser), it
  copies a JSON export to the clipboard, and they paste it in.
- `POST /api/import/mukify` (`lib/mukify-import.ts`) matches each item to our
  catalogue by **serial number** (fallback: name), creates owned/wishlist mugs,
  skips ones already present (folded name), and maps `boughtPrice`/`boughtDate`/
  `comment`/`stickered`→`hasTag`.
- The bookmarklet queries `collectionItem(type: 1|2, first/offset)` on
  `database-prod.mukify.com/graphiql/` with `credentials:"include"` (CORS only
  allows `https://www.mukify.com`). `type: 1` = collection, `type: 2` = favorites
  — **verify this split on the first real export**.
- **Simpler path — by username** (`ImportDialog` → "Med användarnamn",
  `POST /api/import/mukify-shared`, `lib/mukify-shared.ts`): Mukify's
  `sharedCollectionItem(publicUsername, collectionType:"1"|"2")` is **public**
  (no auth). The shared node has no name/serial, so we build a **UUID→serial
  index** from Mukify's public catalogue (cached 1 h) and match on `item.uuid`.
  Requires the user to share the collection/wishlist on Mukify (may be paid);
  no price/date/notes come through this route.
- **Browser extension** (`extension/`, Chrome/Edge MV3): a floating button on
  mukify.com. The service worker fetches `collectionItem(type 1|2)` with the
  browser's session (host permission) and POSTs to `/api/import/mukify` with a
  token from `POST /api/import/token` (see `lib/import-token.ts`, HMAC of
  `IMPORT_TOKEN_SECRET`/`AUTH_SECRET`, 24 h). `ownerFromImportToken` accepts it.
  Install: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
  `API_BASE` in `background.js` is hardcoded to the Vercel URL — update if the
  domain changes. Desktop only (mobile browsers have no extension support).

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
- [ ] **Mukify migration:** username + bookmarklet + Chrome extension built (see
  §6). **Verify with a real account**: (a) does the Mukify plan allow sharing
  (username path — free accounts can't), (b) is `type:1` owned / `type:2`
  wishlist, (c) the extension's cookie access from the service worker. Add an
  "already imported" dry-run preview if useful. Not yet published to the Chrome
  Web Store.
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
- `interactiveWidget: "overlays-content"` in `app/layout.tsx` keeps the on-screen
  keyboard overlaying content rather than resizing the page.
- The add menu (`AddMenu`) is a Radix **Popover** anchored via `virtualRef` to
  whichever trigger was tapped (FAB or header `Add`); the file/camera inputs are
  always mounted and clicked **synchronously** in the handler so iOS keeps the
  user gesture.
- Back-gesture handling (`useBackToClose`): each open dialog pushes one sentinel
  history entry; closing programmatically calls `history.back()` with a
  `suppressPops` counter so our own traversal doesn't close the dialog below it.
  Dialogs are stacked so only the top-most responds.
- Type scale: rem steps in `app/globals.css` (`--fs-h1` 1.75 → `--fs-caption`
  .75, `--fs-body` = **1rem**; `--fs-tiny` was dropped). Only `.t-h1/.t-h2/.t-h3/
  .t-label` utilities remain (the rest were unused). Scale the whole UI by
  changing `html{font-size}`; never hard-code font sizes. Use `/type` to
  experiment (see §4).
- Font weights: `--fw-light/regular/medium/semibold/bold` (300–700; Jost 300–700
  loaded). Headings (`h1`, `.t-h1`, `.t-h2`, `.modal h2`) are bold. Set in `/type`.
- Icon sizes: `--icon-xs/sm/md/lg/xl` (17/16/16/17/28px), applied by context via
  CSS (`.badge svg`, `button svg`, `.icon svg`, `.addbtn svg`, `.addmenu-item
  svg`, `.fab svg`) — CSS width/height beats the SVG attributes. Set in `/type`.
- Size tokens (use these, not raw px): radii `--radius-xs/sm/md/lg/xl/2xl/pill`
  (`--radius` aliases `--radius-sm`); a 2px space scale `--space-2 … --space-48`
  for padding/margin/gap **and** top/right/bottom/left (negatives are
  `calc(-1 * var(--space-N))`); controls `--tap-min` (44), `--control-sm` (36),
  `--control` (38), `--control-lg` (46), `--control-xl` (64), `--thumb-sm` (54),
  `--thumb` (78), `--photo` (112).
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

- **2026-09-17 · v1.66.1** — Collection tab header now shows its `(n)` count,
  like Wishlist.
- **2026-09-17 · v1.66.0** — Added a **size token layer** (radii, 2px space scale,
  control/touch sizes) and swept the whole stylesheet onto it; toast now uses
  those tokens (X → `--icon-lg`).
- **2026-09-17 · v1.65.1** — Toasts bigger still (h3 text, 36px close X, 44px
  pill Undo); Undo now restores a mug to its previous position (re-inserted after
  the row that was above it) instead of the top of the list.
- **2026-09-17 · v1.65.0** — Toasts: larger text (`--fs-body`) and a countdown
  progress bar (toast `::before`, 4 s default / 6 s for the undo toast via the
  `toast-long` class); pauses on toaster hover like Sonner's timer.
- **2026-09-17 · v1.64.1** — Fix red flashes while a swipe-deleted row reflows:
  FLIP now keys the `.mugrow-swipe` wrapper (not the inner row), so the red
  delete layer moves with the row instead of being exposed.
- **2026-09-17 · v1.64.0** — Tab swiping back to native Embla (live drag); row
  delete swipe is now direction-per-tab (right on Collection, left on Wishlist).
- **2026-09-17 · v1.63.0** — Removed the delete button from list/grid items; added
  it to the edit dialog and as **swipe-left on list rows**; deletes now show a
  stacked **Undo** toast (6 s soft-delete). Removed the confirm-delete dialog.
- **2026-09-17 · v1.62.0** — Cleanup: removed 10 dead CSS classes and the unused
  `.t-body/.t-ui/.t-secondary/.t-caption/.t-tiny` utilities + `--fs-tiny`. Added
  **font-weight tokens** (`--fw-*`, Jost 700 loaded), made headings bold, and
  added weight sliders + per-atom weight pickers to `/type`.
- **2026-09-17 · v1.61.0** — Applied the `/type` spec: most atoms moved to
  `body`/`secondary` (buttons, inputs, labels, `.mini`, `.help`, `.sub`, chips),
  `mugname`/`pickname` → `h3`, empty title → `h1`, `deal-price` → `h3`; added
  icon-size tokens (17/16/16/17/28px) applied by context.
- **2026-09-17 · v1.60.0** — `/type` tool: added composed components (list, grid,
  search+filters, add/edit dialogs, add menu, empty state, deal row, stats) that
  follow the atom picks, plus an icon-size panel (5 tokens).
- **2026-09-17 · v1.59.0** — Reverted the scale to the old values (keeping
  `--fs-body` = 1rem); `.mugrow-name` now uses `h3`. Added the **`/type`** scale
  playground (scale sliders + per-component class picker + copyable spec).
- **2026-09-17 · v1.58.0** — Rescaled the type scale: `--fs-tiny` .875 →
  `--fs-h1` 2.5rem, `--fs-body` = 1rem (16px base unchanged).
- **2026-09-17 · v1.57.0** — Reworked the empty collection state: mug-shelf
  illustration + three purple actions (Take photo / Choose photo / Search).
- **2026-09-17 · v1.56.0** — Added the **Chrome/Edge extension** (`extension/`):
  one-click Mukify import via a floating button; `POST /api/import/token` +
  HMAC import tokens; import dialog gained a "Browser extension" tab.
- **2026-09-17 · v1.55.2** — Import: friendly messages for Mukify's "no public
  username"/"no such user" errors (the username path needs a public username +
  sharing; a free account without sharing must use the bookmarklet tab).
- **2026-09-17 · v1.55.1** — Fix Mukify pagination: `first` is capped at **100**
  (both the username import and the bookmarklet used 200).
- **2026-09-17 · v1.55.0** — Mukify import by public **username** (uses Mukify's
  public shared-collection API; no bookmarklet/login) — the default mode in the
  import dialog; the bookmarklet stays as a fallback.
- **2026-09-17 · v1.54.1** — Import dialog: "Copy code" path + mobile/PWA steps
  (no bookmarks bar to drag onto).
- **2026-09-17 · v1.54.0** — Mukify migration: draggable bookmarklet (runs in the
  user's Mukify session) + paste-import dialog + `POST /api/import/mukify`
  (`lib/mukify-import.ts`). No Mukify credentials touch our servers.
- **2026-09-17 · v1.53.0** — Clearer button press: fast dip to scale(.92), springy
  bounce-back, inset pressed shadow, stronger ripple.
- **2026-09-17 · v1.52.1** — Add-menu items are now large Material 3 pill
  buttons (lavender, ~FAB-sized, staggered); FAB darkens + rotates to ×.
- **2026-09-17 · v1.52.0** — Add flow starts from a Material-style FAB context
  menu (Radix Popover): photo / choose image / search catalogue; the in-dialog
  "choose" stage is gone.
- **2026-09-17 · v1.51.1** — Edit dialog's Save button stays disabled until an
  editable field actually changes.
- **2026-09-17 · v1.51.0** — Add flow is now a centred dialog (vaul removed) with
  a single secondary Close action; add-confirm has Save / Save and add more /
  Cancel; back gesture closes the top dialog.
- **2026-09-17 · v1.50.0** — Add-confirm dialog split into "Förvärv"
  (acquisition date defaulted to today + payment) and "Egenskaper" (condition,
  etikett, notes) sections; notes + acquisition date now captured on add.
- **2026-09-17 · v1.49.0** — Wishlist quick-add skips the confirm (heart pop +
  toast); add-drawer stages cross-fade; list-view star button is gold when
  active and the thumbnail badge is gone.
- **2026-09-17 · v1.48.0** — Add-confirm dialog: removed the owned/wishlist
  selector and the "optional" copy; `.switch` rows now match input styling; all
  `<select>`s use a bigger, bolder themed chevron.
- **2026-09-17 · v1.47.0** — Add drawer now stays open behind the confirm dialog
  (add several mugs in a row); fixed the drawer close animation that slid from
  the top-left instead of straight down (transform leak from `.modal`).
- **2026-09-17 · v1.46.0** — Added motion design: press ripples, FLIP list
  animations, animated delete (fade + reflow), favourite star pop/ring, sliding
  tab + segmented indicators, animated stats, collapsible filters, dialog
  transitions. New `lib/motion.js`; reduced-motion respected.
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
