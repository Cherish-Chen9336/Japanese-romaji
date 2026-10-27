# kana. — Japanese Romaji Typing Trainer

**→ [Try it in your browser](https://cherish-chen9336.github.io/Japanese-romaji/)** — no signup,
nothing to install.

A browser app for practicing Japanese typing. It shows Japanese text, you type the
romaji for it, and the app measures where you actually slow down — per mora, not
just per word — then builds a picture of what you have and have not mastered.

SolidJS, TypeScript and Vite. No backend: everything runs and persists in the
browser.

![The kana. practice screen: a line of Japanese with the romaji being typed beneath it, over an on-screen keyboard](docs/screenshot.png)

## What it does

- **Practice** — work through a passage or run a timed sprint. Text comes from
  bundled kana tables, drills, words and quotes, from the mistakes you keep
  repeating, or from your own library.
- **Library** — paste in plain Japanese, confirm or supply the kana readings for
  any kanji, and it becomes practice material.
- **Stats** — per-mora timing, lifetime totals, a progress chart, and a confusion
  table showing which romaji keys you hit instead of which.
- **Mastery map** — which kana groups you have actually learned, split by seion,
  dakuten and yoon.
- **Settings** — paragraph length; system, light, dark or book theme.

## Your progress stays in your browser

There is no account and no server. Progress lives in that browser's IndexedDB and
localStorage, which means it does not follow you to another device and it goes
away if you clear the site's data. **Settings → your data** exports the whole
profile to a file and imports it back, which is the way to move it.

## Architecture

Three layers, enforced rather than hoped for:

```
src/engine/   pure TypeScript — no DOM, no localStorage, no window
src/io/       the only layer allowed to touch browser storage (IndexedDB)
src/ui/       SolidJS components
```

`src/layer-purity.test.ts` walks the source tree and fails the test suite if
`engine` imports from `io` or `ui`, or if `io` imports from `ui`. Without it, "pure
engine" would be a convention someone could break in a later edit. Note that
`pnpm build` runs only `tsc -b` and Vite, so run `pnpm test` to enforce the
boundary.

Randomness and clocks are **injected, never defaulted**. `RandomSource` is a
required parameter rather than one that falls back to `Math.random`, so no engine
function can quietly reach for the global source and stop being reproducible. The
application boundary injects the real source; tests inject a deterministic one.

## Testing

```bash
pnpm test              # run the suite once
pnpm test:watch        # watch mode
pnpm test:coverage     # coverage via v8
pnpm typecheck         # tsc -b
```

Coverage thresholds are gated in `vite.config.ts`:

| Path | Statements | Lines | Functions |
| --- | --- | --- | --- |
| `src/engine/**` | 100% | 100% | 100% |
| `src/io/**` | 80% | 80% | — |

`pnpm test` does not check coverage, so a drop passes there and fails only under
`pnpm test:coverage`. Run it before calling engine work done.

## Running it

This project uses **pnpm**. `pnpm-lock.yaml` is the only lockfile, so
`npm install` would write a second one beside it and resolve different versions.
Nothing enforces this — there is no `packageManager` field — so it is a
convention you have to follow rather than one the tooling keeps.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # production build into dist/
pnpm preview    # serve the build at the real published base path
```

Use `pnpm preview` rather than the dev server to check a build: `vite.config.ts`
sets `base` to `/Japanese-romaji/` for `build` and preview and to `/` for dev, so
a path problem that would 404 on the live site only shows up under preview.

## Deploying

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`.
It is the only CI here, so the gates live in it: typecheck, then
`pnpm test:coverage`, then the build — a failure in any of them stops the publish.
Pull requests against `main` run the same three gates and publish nothing.

## License

MIT — see [LICENSE](LICENSE).
