# Agent notes

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
  weights + calibration). Run it after changing `lib/master-catalog.json` or the
  augmentation in `scripts/build-mug-embeddings.mjs`.
- `npm run label -- <folder>` starts a local tool to label real mug photos
  (top-4 picker), writing `labels.jsonl` for later fine-tuning.
- The app collects confirmed/corrected matches into the `match_feedback` table
  (`POST/GET /api/match-feedback`) to accumulate a real-photo dataset.
