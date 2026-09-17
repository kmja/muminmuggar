# Agent notes

> **Start every session by reading [`HANDOVER.md`](./HANDOVER.md).** It holds the
> current version, architecture, behaviour, conventions and open threads — and it
> must be kept up to date. After finishing work, update `HANDOVER.md` (version,
> changed sections, open threads, recent-work log) and commit it with the change.

## Workflow
- After completing a change, **always commit and push to `main`** — no need to ask first.
- Commit style: a concise summary line ending with the version, e.g. `Rework the add-mug dialog (v1.14.0)`.
- Bump the version on every push, in all three places:
  - `lib/version.js` (`APP_VERSION`)
  - `package.json` (`version`)
  - `package-lock.json` (root `version`, both occurrences)
  - Tip: `npm version <x.y.z> --no-git-tag-version` updates package.json + lock; edit `lib/version.js` by hand.
- Use a minor bump for features, patch for small fixes.

## Verify before pushing
- `npx tsc --noEmit`
- `npm run build`

## On-device mug recognition
- Matching is free and runs in the browser: DINOv2-small (from a CDN) + a ridge
  linear probe over the catalogue, with a top-4 picker and a Gemini fallback.
- `npm run build:embeddings` regenerates `public/mug-embeddings.json` (probe
  weights + calibration) **and** `lib/probe-base.json` (the synthetic normal
  equations used for on-site fine-tuning). Run it after changing
  `lib/master-catalog.json` or the augmentation in `scripts/lib/augment.mjs`.
- On-site labeling: open `/label` on the deployed site, upload photos, and click
  through the top-4. Images + labels live in Postgres (`label_images`, `labels`);
  the per-owner fine-tuned probe is in `mug_models` (`/api/finetune`, `/api/model`).
  `eval:labels` / `label-tool` still work locally against a downloaded
  `labels.jsonl` (`/api/labels/export`).
- The app collects confirmed/corrected matches into the `match_feedback` table
  (`POST/GET /api/match-feedback`) to accumulate a real-photo dataset.
