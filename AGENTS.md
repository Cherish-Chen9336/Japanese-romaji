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
  Storage is split on purpose. **Records** — the library, lifetime stats, the
  miss and confusion tables — live in IndexedDB (`io/records.ts`), written whole
  because each stays small. **Run history** has its own IndexedDB store
  (`RUNS_STORE`, one record per run, `autoIncrement` keys) because it does not
  stay small. As one blob, saving a run rewrote every run ever typed: measured in
  Chromium at 197 ms against 5,000 runs and 926 ms against 20,000, growing
  without bound. Appending one record measured 0.3–1 ms at every size. Use
  `appendRun` to save; `replaceRuns` is for importing a backup, not for saving.
  The v1 single-blob `records.runs` key migrates on first read and is deleted
  rather than copied — it is the whole history, so leaving it doubles the
  profile's size forever. **Preferences** — paragraph length, keyboard
  visibility and layout, kana
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

### Mastery is tracked per mora, not per key

`kanaStats` sits alongside `keyStats` because the two answer different
questions. `h` being slow says nothing about whether し or ひ is the problem,
and — the reason this exists at all — a miss mid-mora frequently has **no single
key to blame while always having a kana**. After `s` on し the legal letters are
`h` and `i`; neither is at fault, so the miss used to be discarded outright.
`expectedKana` resolves that: ambiguity in the spelling is not ambiguity in the
mora. Genuinely ambiguous boundaries (ん before な) stay unattributed rather than
guessed.

**One attempt is one encounter with the mora, not one keystroke.** Counting
keystrokes divided the error rate by the length of the spelling, so the same
single fumble scored あ at 50% and しゃ at 25% — ranking the harder kana as the
easier one — and a three-letter kana cleared a "seen three times" floor on its
first appearance. The pending mora is identified by *token index*, not by name,
because ここ is two separate encounters with こ.

**A mora's duration is measured as excess over the run's own cadence.** Raw
`totalMs` is time-to-type-the-whole-spelling, so it rises with the number of
letters: a flawless typist at a constant 100 ms recorded あ at 0 ms, か at 200 and
しゃ at 300, having hesitated nowhere. `weakestKana` broke ties on that, handing
the tie to whichever mora was spelled with more letters. `mergeMoraStats`
subtracts `keystrokes × run.baselineMs` — the run's median clean inter-keystroke
interval — leaving only the hesitation the typist actually owns. Three rejected
alternatives, each a trap: **onset only** (the pause before the first keystroke)
misses the mid-mora decision, which for しゃ is exactly where `sha` vs `sya` is
recalled; **dividing by keystroke count** reintroduces the dilution that per-mora
counting exists to remove, scoring one 500 ms stall as 500 on あ but 233 on しゃ;
**max interval** gives a three-key spelling three chances to draw a large value
where a one-key spelling gets one. The baseline is per run because it belongs to
the sitting — subtracting one run's cadence from another's timings reports the
difference between a tired day and a quick one as difficulty with a kana. Excess
is summed **signed**; clamping negatives per encounter would let long spellings
collect positive noise from more keystrokes than short ones can.

**Durations are kept only for encounters that were cleanly timed and
mistake-free.** `timingSamples` is the denominator, not `attempts`. The first key
of a run has no predecessor to measure against and `applyBackspace` clears
`lastKeyAt` on purpose, so the key after an edit has none either — those are
unobserved intervals, not zero-millisecond ones, and counting them as zero made a
key pressed only in those positions report itself as instant. Time after a miss
is recovery time; counting it would charge one fumble twice, to the error rate
and again to the clock. At an ん boundary the interval is genuinely
unattributable — in `nna` the second `n` opens な, but in `nnna` it belongs to ん —
so both encounters give up their clock rather than guess. The attempt and the
miss always survive, so the error signal, which is the one that ranks a mora, is
never affected by any of this.

Absent `timingSamples` means "written before this existed" and falls back to
`attempts`, reproducing exactly what those runs already displayed. That, and
storing excess in new fields rather than redefining `totalMs`, is why this needed
no migration, no `DB_VERSION` bump and no backup version bump.

**Nothing ranks on speed blended into accuracy.** `topTimingStats` sorts on time
alone and `smoothedErrorRate` drives the key heatmap's opacity alone. The old
`avgMs + errorRate * 500` and `avgMs / 600 + errorRate` were not unit errors — a
rate times milliseconds is milliseconds — but something worse: an arbitrary,
undocumented exchange rate between speed and accuracy, feeding a list headed
"slowest" whose only column was milliseconds, and a keyboard tint where one shade
stood for two different problems. Where a surface has one channel, accuracy gets
it; speed goes in the tooltip or a panel of its own.

`weakestKana` ranks on a **smoothed** error rate rather than a raw one behind a
minimum-attempts gate. The gate threw away the strongest signal available: a
mora missed on both of the two times it has been seen is more clearly weak than
one missed twice in eight, and the gate hid the first while ranking the second.
Smoothing pulls a low-evidence rate toward "probably fine" instead of discarding
it. Speed breaks ties but never gets a kana onto the list alone — a mora you have
never mistyped isn't weak, however slow.

Only **real moras** are tracked. Word separators carry a space and an item the
kana table can't reach falls back to one token per romaji character, so an
uploaded `日本語|nihongo` produced tokens named `n`, `i`, `h`, `o`, `g` — which
landed in the table, could fill the weakest list, and then matched no Japanese
item at all, silently stopping drills from targeting anything.

**A miss is charged to the mora being started, not the one just finished.** At a
mora boundary the cursor has completed あ and not yet opened か: `expectedToken`
knows it is waiting on か and the screen says so, but the encounter being held was
still あ, so the table charged the fumble to the mora typed correctly and left the
fumbled one clean. The first key of a mora is where recall happens, which makes
this the most common miss there is — it inflated the error rate of moras you know
and hid the ones you don't, and both `weakestKana` and drill selection read the
result. At an ん boundary it was worse than misplaced: one fumble was charged to
ん *and* to the following mora. `carriedMiss` holds a miss that belongs to a mora
which has not opened yet until it does. The invariant, swept over every position
of four words in `session.test.ts`: whatever the UI names as the mora at fault is
the mora the table charges.

Attribution reads the state **after** each keystroke, not before. Before it, ん
followed by anything is ambiguous — the next key could extend it to `nn` or open
the following mora — and attributing on that pre-state discarded every keystroke
at such a boundary. んあ recorded ん and lost あ entirely; せんせい, でんしゃ and
日本語 all contain one.

Drills match an item's **tokens**, never a substring of its text. し appears
inside しゃ as a character, so a substring test chose でんしゃ and かいしゃ to
practise し when neither contains a standalone し — spending encounters without
touching the weakness that selected them.

Targets are the weakest moras **plus the least-practised ones**. Weakness alone
cannot drive practice: a mora is only found weak once you have met it and failed
it, so a pool built only of known weaknesses stops showing you anything else.
Simulated over 150 runs, the exploit-only pool collapsed to four items and two
genuinely hard moras were never shown once; with exploration all 108 corpus moras
get seen and all three planted weaknesses are found and fixed.

Known limitation: selection filters but does not weight, so a weak mora appearing
in one item gets less practice than an equally weak one appearing in ten.

### The mastery map

`engine/mastery.ts` lays the 五十音 chart out for display and `ui/MasteryMap.tsx`
tints it. It is the Statistics page's primary answer to "what do I not know", and
it replaced the weakest-kana bar list.

Columns are derived from each mora's own spelling, never hardcoded, so the chart
cannot drift from `gojuonBank`. The last vowel of the romaji picks the column:
`ya`, `yu`, `yo` put や ゆ よ under a, u and o with gaps at i and e, which is
where they belong and *not* where filling a row left to right puts them. ん has
no vowel and gets a row of its own — filed under a column it would read as a form
of わ. Three grids, because contracted rows spell only や, ゆ and よ and would
otherwise carry two empty columns each.

**Three cell states, not an opacity ramp.** Never met, met and never missed, and
missed. A single ramp collapses the first two into the same pale cell, which
tells a beginner they are fine at every kana they have yet to see. Only the
missed cells carry colour.

**Accuracy gets the colour; timing goes in the tooltip.** See "Deliberately not
built" for why speed never gets a channel of its own here.

Moras that are tracked but have no cell — sokuon, in practice, since 五十音 has no
square for っこ — are rendered in an "also tracked" strip driven by what has
actually been met. Dropping them would let the weakest-kana line, drawn from the
same table, name a mora as your worst and then show it nowhere.

### The input model

Typing runs against **kana tokens**, not a fixed romaji string. `engine/prompt.ts`
compiles a lesson's items into `RomajiToken[]` (one per mora, each carrying every
spelling that types it); `engine/session.ts` drives that with `stepWithRecovery`.

Three properties this has to keep, each with tests that fail loudly if it breaks:

- **Wrong keys have two treatments, and `stopOnError` picks between them.**
  The default refuses the key: nothing is consumed, the cursor holds, and the
  **caret** turns solid red — never the text. Colouring the character being
  waited for was tried and is a trap: red text reads as something you typed, so
  the instinct is to backspace it, and backspace takes the correct character to
  its left instead, because the refused key never entered the line. Every Japanese typing site does
  this, because romaji input assembles a kana rather than filling a slot — a key
  that half-assembles nothing leaves the typist mid-mora with no way to see what
  state they are in. Recovery costs one keypress, not a backspace.
  With it off, a wrong key is an ordinary key: drawn red, cursor moves on,
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

## Deliberately not built

Decisions to *not* do something leave no commit and no code, so they live here or
nowhere. Each of these has been proposed at least once and rejected on purpose;
re-proposing one is fine, but start from the reason it lost.

The capability gap audit of 2026-08-21 (artifact
`5d7fd5a8-93ee-42c7-a671-6fbc16d50d03`, measured against
`/home/web-ella/githubs/type-review`) is the source of several of these. It is a
useful inventory, but it measures this app against an **English** trainer, so
"missing" in it sometimes means "does not apply". Where this section and that
audit disagree, this section is current.

- **A per-key mastery heatmap on the practice keyboard.** The audit lists it as a
  missing capability because the reference has it. It does not transfer. One
  Latin key types many moras — `n` alone covers な, に, ぬ, ね, の and ん — so a
  tinted keycap cannot say which mora is at fault, and there is no honest way to
  aggregate: worst-of makes one weak mora accuse five keys, average-of hides it,
  and `shi`/`si`/`ci` make the projection unstable on top. `scoredKey` also drops
  a miss whenever more than one key was legal — 12% of misses across the corpus,
  21% in the difficult bank, so the loss is worst exactly where the material is
  hardest. The practice keyboard already has a job, orientation and pressed-state
  feedback, and persistent historical colour competes with it. Mastery belongs on
  the 五十音 grid instead, which fits the data almost exactly: 104 of the 108
  tracked moras sit on the chart, every chart cell is reachable from the corpus,
  and the only four outside it are sokuon (っこ っし って っと).
- **A keyboard heatmap tinted by speed, anywhere.** `keyStats` timing charges the
  interval to the key just pressed, so whichever key *starts* a mora absorbs the
  kana-recall pause. Twelve consonants — `b c d f g j m n p r w z` — never once
  appear mid-mora in this corpus, while `a` and `o` are mora-initial 6% and 4% of
  the time. A speed heatmap would light the consonant row for every user forever;
  that is the CV structure of Japanese, not a finger problem anyone can act on.
- **Speed as a second colour channel on the 五十音 mastery map.** Accuracy gets the
  one colour channel; excess latency goes in the tooltip and in panels of its
  own. This is the same rule `weakestKana` already follows — speed breaks ties
  but never ranks a mora on its own — and one shade standing for two different
  problems is what made the old `avgMs / 600 + errorRate` tint unreadable.
- **Colemak/Dvorak keycap maps, digit and ASCII-punctuation drills, and
  source-code passages.** All three are real capabilities in the reference and
  all three are about typing English. Romaji has no digits or ASCII punctuation
  to drill, 、 and 。 would need their own design rather than a toggle, and
  remapping keycaps has near-zero value for someone learning kana on QWERTY.

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
