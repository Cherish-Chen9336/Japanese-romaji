# Japanese Romaji Typing Trainer

A browser app for practicing Japanese typing. It shows Japanese text, you type the
romaji for it, and the app measures where you actually slow down — per mora, not
just per word — then builds a picture of what you have and have not mastered.

SolidJS, TypeScript and Vite. No backend: everything runs and persists in the
browser.

## What it does

- **Practice** — work through a passage or run a timed sprint. Text comes from
  bundled kana tables, drills, words and quotes, from the mistakes you keep
  repeating, or from your own library.
- **Library** — paste in plain Japanese and it becomes practice material.
- **Stats** — per-mora timing, lifetime totals, a progress chart, and a confusion
  table showing which kana you mistake for which.
- **Mastery map** — which kana groups you have actually learned, split by seion,
  dakuten and yoon.
- **Settings** — Mac or Windows keyboard layout; system, light, dark or book theme.

## Architecture

Three layers, enforced rather than hoped for:

```
src/engine/   pure TypeScript — no DOM, no localStorage, no window
src/io/       the only layer allowed to touch browser storage (IndexedDB)
src/ui/       SolidJS components
```

`src/layer-purity.test.ts` walks the source tree and fails the build if `engine`
imports from `io` or `ui`, or if `io` imports from `ui`. Without it, "pure engine"
would be a convention someone could break in a later edit.

Randomness and clocks are **injected, never defaulted**. `RandomSource` is a
required parameter rather than one that falls back to `Math.random`, so no engine
function can quietly reach for the global source and stop being reproducible. The
application boundary injects the real source; tests inject a deterministic one.

## Testing

```bash
npm test              # run the suite once
npm run test:watch    # watch mode
npm run test:coverage # coverage via v8
npm run typecheck     # tsc -b
```

Coverage thresholds are gated in `vite.config.ts`:

| Path | Statements | Lines | Functions |
| --- | --- | --- | --- |
| `src/engine/**` | 100% | 100% | 100% |
| `src/io/**` | 80% | 80% | — |

`npm test` does not check coverage, so a drop passes there and fails only under
`npm run test:coverage`. Run it before calling engine work done.

## Running it

```bash
npm install     # or pnpm install
npm run dev     # http://localhost:5173
npm run build   # production build into dist/
npm run preview # serve the build locally
```
