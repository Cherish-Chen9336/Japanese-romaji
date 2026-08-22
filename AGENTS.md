# Project Instructions

> Japanese-romaji

## Guidelines

<!-- Add project-specific instructions here -->

## Testing

TDD workflow, established 2026-08-20. Layout follows `type-review`'s three-layer
split: `engine/` pure logic → `io/` browser adapters → `ui/` SolidJS.

- `pnpm test` — run the suite once. `pnpm test:watch` — watch mode.
  `pnpm test:coverage` — coverage via v8. **`engine/` is gated at 100%
  statements, lines and functions** (`vite.config.ts`). `pnpm test` does not
  check coverage, so a drop passes there and only fails under
  `pnpm test:coverage` — run it before calling engine work done.
- Two rules for the tests themselves, both learned from tests that couldn't
  fail: assert an invariant over the function that can *reject* (`compileStrict`,
  not `compileItem` — the latter's fallback accepts anything), and when a helper
  feeds input to a state machine, assert the input was actually *consumed*.
  A test that fed `nn` and checked only "finished, no mistakes" passed against a
  state that stopped after one keystroke.
- `pnpm typecheck` — `tsc -b`, same check `pnpm build` runs first.
- **`src/engine/`** — pure TypeScript, no DOM, no `localStorage`, no
  `window`. All randomness and clocks are injected (see `engine/rng.ts`'s
  `pickRandom(items, rng)` and `engine/stats.ts`'s `now` params) rather than
  called directly, so every function is deterministic in tests. Default
  vitest environment is `node` — this is where nearly all logic should live
  and where new features should be designed test-first.
- **`src/io/`** — the only layer allowed to touch `localStorage`/`window`.
  Storage is split on purpose. **Records** — run history, the library, lifetime
  stats, the miss and confusion tables — live in IndexedDB (`io/records.ts`),
  because they grow; run history used to be capped at 100 to fit localStorage.
  **Preferences** — paragraph length, keyboard visibility and layout, kana
  group, source — stay in localStorage, because reading them synchronously is
  what lets the first paint happen without awaiting a database. Records are
  parsed by the same validators the localStorage path used, so hardening applies
  to both. `migrateLocalStorage` copies an older profile across once, and only
  into an empty store — otherwise clearing your history would resurrect it from
  the stale copy on the next load. `io/backup.ts` exports, imports and resets the
  whole profile. The file carries a format marker and a version, and an
  unrecognised version is **refused** rather than read as best it can be —
  guessing at a newer release's fields would corrupt a profile instead of
  declining to touch it. Import replaces rather than merges: merging two
  histories double-counts runs and invents streak days that never happened.
  Test files here open with `// @vitest-environment jsdom` at line 1 (must
  be the first line of the file; it sets the environment for the whole
  file, not a per-block override).
- **`src/ui/`** — SolidJS components and `router.ts`. `App.tsx` itself is
  intentionally left without direct tests for now — it's kept thin (wiring
  + JSX) and the logic it calls is tested at the engine/io layer instead.
  The same holds for the `.tsx` components here: no Solid testing library is
  installed, so components are verified by rendering the real app in a
  headless browser (Playwright, a devDependency) rather than by unit test.
  Pure data a component consumes — e.g. `ui/keyboard-layouts.ts` — is a
  normal vitest target and should be tested.
- **`src/layer-purity.test.ts`** enforces the boundary: engine must never
  import from `io/` or `ui/`, and `io/` must never import from `ui/`. Keep
  new pure logic in `engine/`, not back in `App.tsx`, or this test catches it.

### The input model

Typing runs against **kana tokens**, not a fixed romaji string. `engine/prompt.ts`
compiles a lesson's items into `RomajiToken[]` (one per mora, each carrying every
spelling that types it); `engine/session.ts` drives that with `stepWithRecovery`.

Three properties this has to keep, each with tests that fail loudly if it breaks:

- **A wrong key is an ordinary key.** It's drawn red and the cursor moves on,
  consuming one edge in *every* direction that was legal — a substitution, not
  an insertion. The tempting cheap version (leave the matcher put, just paint
  the key red) reads as forgiving but is not: the typist still owes the matcher
  every character of the mora they fumbled, so `x` before し costs four
  keystrokes instead of three. `session.test.ts` pins this as "costs a mistyped
  mora no more keystrokes than a clean one".
- **Exact transitions beat substitutions.** んな typed `n`,`n`,`n`,`a` is
  correct — the third `n` opens な on the `nn` branch. Scoring it as a
  substitution on the other branch would invent an error.
- **Every bundled item is typeable as written.** Checked in `prompt.test.ts`
  across all four banks, with no exclusions. A `reading` field covers the
  grammatical particles (こんにちは displays は, types `wa`); anything whose
  romaji the kana table can't reach falls back to typing that romaji literally,
  which is what keeps an uploaded `日本語|nihongo` from demanding kanji input.

### Lesson content

`TextItem` is `{ kana, romaji, reading? }`. `kana` is what's **displayed**;
`reading ?? kana` is what's **typed**. That split is what makes both the
grammatical particles (こんにちは shown, `konnichiwa` typed) and kanji (学校
shown, `gakkou` typed) work with no extra machinery — the same arrangement every
Japanese typing site uses. **You only ever type kana**: kanji is display only.

`engine/furigana.ts` draws the reading over the kanji. It must never annotate
kana — こんにちは carries a `reading` because は is a particle there, and stacking
こんにちわ on top of it would present a spelling difference as a pronunciation
gloss. A `reading` must mirror its `kana`'s word breaks, since the two are zipped
per word.

`compileStrict` compiles curated content and returns null when an item's romaji
isn't derivable from its own kana; `compileItem` adds a literal fallback for
uploads, where the user's `kana|romaji` pair is authoritative. **Assert bank
invariants over `compileStrict`** — phrased over `compileItem` they can't fail,
because the fallback manufactures tokens for any romaji at all.

`compileStrict` also promotes the item's own spelling to the front of each
token's candidates, so the on-screen hint teaches what the item is written with.
The 五十音 chart depends on it: だぢづでど is taught `dadidudedo`, because
`ji`/`zu` are the keystrokes that produce じ/ず, not ぢ/づ.

`gojuonBank` holds the chart, one row per item, tagged `seion` / `dakuten` /
`yoon`, and backs the `kana` source. Never gate it on speed — a beginner needs
the chart most. It is also excluded from `auto`: the chart is a drill you pick,
not something to be handed unasked mid-word-practice.

Lessons are dealt from a shuffled deck (`dealRandom`), not drawn independently —
independent draws routinely produced eight copies of one word while leaving most
of the bank unseen.

Known limitation, deliberate: the matcher is not an IME. It checks input against
an already-known kana target rather than decoding romaji into kana, so it accepts
`n` before a vowel (んあ as `na`) where a real IME would require `nn`. Fine for
transliteration practice; wrong if this ever becomes input-method training.

## Shared Memory

**Always write new instructions, rules, and memory to `AGENTS.md` only.**

Never modify `CLAUDE.md` directly — it only imports `AGENTS.md`.
This keeps Claude Code, Codex CLI, and Antigravity CLI (`agy`) on the same
context; Codex and `agy` both read `AGENTS.md` natively.

## Project Structure

- `.claude/` — Claude Code skills, agents, rules, hooks, commands
- `.agents/skills/` — symlink to `.claude/skills/` (Codex skill scan path)
- `.codex/prompts/` — Codex slash-command prompts
- `.codex/hooks.json` / `.codex/config.toml` — Codex hooks/config (optional)
- `.mcp.json` — MCP server registrations (Claude Code + Codex)
