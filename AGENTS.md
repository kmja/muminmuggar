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
