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
  called directly, so every function is deterministic in tests. **`RandomSource`
  is required, never defaulted to `Math.random`** — a default made that a
  convention rather than a guarantee, since any function could quietly reach for
  the global source and stop being reproducible, and nothing stopped a new one
  from doing the same. The application boundary injects the real source. Default
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
  visibility, kana
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

**A keystroke aimed at another mora is not this mora's time.** After あ is
complete, a refused key meant for か leaves the matcher settled on あ — and
charging あ that gap gave a mora typed cleanly the duration of a failure at the
next one. Accuracy was already right there; the clock was not.

**Coming back from a hidden tab clears `lastKeyAt`.** The gap since the last
keystroke is not typing, it is however long the tab was away — clamped to the
pause cap and then charged to whichever mora came next. The first keystroke back
is deliberately untimed, the same treatment the first key of a run and the key
after a backspace already get.

**The baseline is drawn from clean typing at both ends.** An interval qualifies
only if this keystroke was correct *and* the one before it was — a consumed wrong
key or a refused one both disqualify the gap that follows. That gap is recovery:
noticing, then finding the right key. Counted as cadence it raised the run's idea
of its own speed and made every clean mora look faster than it was, which is the
opposite of what the baseline exists to do.

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

A run and the lifetime aggregate it feeds are written by `commitRun` in **one
transaction**. As two writes, a crash or a closed tab between them left the
profile disagreeing with itself — a run no total counted, or totals claiming a
run whose record was never written — and nothing afterwards records which half
was the truth.

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
genuinely hard moras were never shown once; with exploration every corpus mora
gets seen (the simulation reported 108, the corpus size at the time; it holds 113
since the bank expansion and has not been re-run) and all three planted weaknesses are found and fixed.

Known limitation: selection filters but does not weight, so a weak mora appearing
in one item gets less practice than an equally weak one appearing in ten.

### The statistics page is a dashboard

Three groups in fixed order, answering three questions: **which kana do I not
know** (the mastery chart and the slow-mora list), **am I improving** (the speed
trend, the practice calendar, recent runs), and **what are my fingers doing**
(romaji keys, confusions, bigrams — labelled secondary, because none of it can
name a mora). Thirteen equal modules made the reader scan everything to find
anything.

Cut, with reasons, so they are not proposed again:

- **slowest letters** — key timing is structurally confounded. Twelve consonants
  are 100% mora-initial in this corpus, so they absorb all the kana-recall pause
  and the list accuses the consonant row for every user forever.
- **source breakdown** — average speed per bank mostly recovers the banks' own
  designed difficulty, and `drills` deliberately selects weak moras, so a slow
  drills average can mean the adaptation is working perfectly.
- **wpm distribution** — five twenty-wpm bins describe a lifetime spread but not
  a direction. Going 20→40 and going 40→20 drew the same picture. Replaced by
  `wpmTrend`, a five-run rolling median with the raw runs behind it.
- **milestones** — cut once, and restored. The reason for cutting was that the
  result screen already shows them, but it only ever showed the ones *newly*
  reached: a notification you either caught or missed, never a ladder you can
  look back at. The panel shows all of them, reached ones filled and checked,
  the rest outlined, with a count. The check is a mark rather than punctuation:
  at the chip's own size a `✓` disappeared into the label beside it.
- **streaks** as its own panel — the current streak is in the overview and the
  longest is one line under the calendar it describes.

The **overview** is learner metrics, not leaderboard metrics: moras seen, weak
moras, recent accuracy, day streak. It previously showed `avg wpm` averaged over
every stored run while `best wpm` was progression-gated — the two disagreeing
about which runs counted — and `current acc` read the *live typing session*,
which on this route is empty, so it reported 100% whatever the history said.

**All four stay together in the page's first row.** Splitting them across the
groups they each describe — moras seen and weak moras into the chart's margin,
accuracy and day streak into "recent progress" — was built and reverted. It is
defensible by the page's own three-question structure, but it costs the page its
opening summary: a reader arriving wants the four numbers before they want them
filed. The "206.8px" and "370.5px" of closed margin cited for this trade were
computed across different flex lines and do not describe anything on screen —
see the mastery panel's entry below. The trade stands on the reading order
alone, which is the ground it should have been argued on.

The **keyboard stays, but as a diagnostic and not a mastery surface**, titled
"romaji key errors" under a note saying that one key types many moras and none of
this can say which mora is at fault. It is the widest panel because legibility is
its only problem; being bigger does not make it mean more.

**Every channel on a cap reads one table.** The count, the error rate, the
weak/clean state and the tint all come from `keyStats`, aggregated over
*completed* runs. The printed count used to read the `misses` record instead —
written on every keystroke and persisted immediately, finished run or not — so
the number and the colour described different populations. On a fresh profile:
type six wrong keys, leave the run, and a cap printed `6` in the teal that means
"never missed". A true number beside a contradicting colour, and the rate under
it was `0% of 0`. A rate needs its own denominator, and `keyStats` is the only
table carrying both halves, so it wins all four channels rather than two.

`misses` is therefore **no longer written**, and had no other reader — the cap's
count was the only one in the app. The record is left readable, importable and
clearable rather than purged: `resetProfile` clears the whole records store, so
nothing is stranded, and an older build reading a backup still finds the field.
No `BACKUP_VERSION` bump, for the same reason retiring the keyboard layout
needed none — a count map carries no measurement another reader could
misinterpret. Whether to drop it from the format is a separate decision.

Panels sit in a twelve-column grid **inside each group**, with the groups in
document order, and carry **no chrome at all** — no border, no fill, no radius.

**The twelve columns are used as twelve.** The grid was only ever addressed as
12 and 6+6, which a two-column grid gives for free. "Recent progress" is 8+4
above 1120px — the chart beside the calendar — then milestones across the row.
"Typing mechanics" is 6+6: the key board beside the two bar lists, which stack
into one column rather than taking a row of their own. No colour was touched to
do it.

**The height figures first recorded here (2588px to 2182px at 1440) came from a
fixture missing two real moras and should not be quoted.** Re-measured against
`87727a6`, the commit before the rework, with every off-chart mora the banks
actually contain:

| width | before | after | change |
|---|---|---|---|
| 320 | 4431 (overflowed) | 4327 | −104 |
| 390 | 4421 | 4340 | −81 |
| 760 | 3082 | **3364** | **+282** |
| 768 | 3086 | **3366** | **+280** |
| 1024 | 2561 | **2764** | **+203** |
| 1120 | 2610 | 2431 | −179 |
| 1440 | 2680 | 2414 | −266 |

So the rework is shorter on phones and above 1120 and **taller by 200–280px
between 760 and 1024**, which the original measurement could not show because
the fixture under-populated the one panel that drives it.

**The cause is not what was first written here.** The first explanation said
`.mastery-aside` claims 513px of the full-width panel and leaves the three kana
tables 451px, so they stack. That is false, and measuring the flex lines shows
why: `.mastery` is `flex-flow: row wrap` and the aside is its **fourth item**,
after all three tables, so it can never hold a column beside them — flexbox
fills a line in document order and wraps what is left over. The preferred widths
are plain 309, voiced 309, contracted 207, aside 513, with 28px gaps:

| viewport | `.mastery` width | line 1 | line 2 | line 3 | panel height |
|---|---|---|---|---|---|
| 1920 | 1688 | all four, 1422 used | — | — | 613.3 |
| 1600 | 1536 | all four, 1422 used | — | — | 613.3 |
| 1500 | 1436 | all four, 1422 used | — | — | 613.3 |
| 1460 | 1396 | three tables, 881 | aside 513 | — | 851.3 |
| 1440 | 1376 | three tables, 881 | aside 513 | — | 851.3 |
| 1024 | 992 | three tables, 881 | aside 513 | — | 851.3 |
| 768 | 736 | plain + voiced, 646 | contracted 207 | aside 513 | 1484.5 |

**The right-hand margin needs a viewport of about 1500px and has never rendered
below it.** Four columns want 1422px and 1440 leaves 1376, so at every width this
project treats as desktop the aside is a centred 513px strip *below* the tables,
not a margin beside them. The "537px hole closed to 370.5px" recorded for
`0a61372` therefore described a layout that does not exist at the width it was
measured at; subtracting one child's height from another's only means something
when they share a flex line. Where all four do share a line (1500 and up) the
unused height under the aside is **395.3px**.

What is real: line 1 carries **306px of unused height** under the short `voiced`
column at every width from 1024 up, and the 760–1024 cost is the three tables
wrapping at 768 plus the aside having become a two-high stack (strip 77.7 above
rankings, 218px total) where the strip alone used to be 77.7px.

**Resolved by laying the aside out along the row wherever it is a full-row
footer** — strip beside the rankings rather than above them — through a
container query on `.panel--map`, because the threshold is a property of the
panel's own width: 1460 behaves like 1024, not like 1500, so no outer-grid
breakpoint can express it. (The existing narrow rule is `max-width: 680px`, not
760, and it only re-columns the rankings grid; it does not put the strip beside
them.) The footer runs from 721px of panel width — 513 strip + 28 gap + 180
rankings, 12rem at the 15px root — to 1462px, the four-column 1422 plus 40px of
headroom. Both numbers describe nine off-chart moras.

Measured: the aside goes from 218px tall to 77.7px, so `.mastery` drops 140.3px
everywhere from 1024 to 1524, and the document drops 140px at 1024, 1120 and
1440 and 105px at 760/768 — less there only because the strip and rankings have
less room, not because the rule works differently. Phones are untouched, since a
358px panel is below the 721px threshold and keeps the column. The threshold is
exact: a panel of 1462 keeps the margin at 613.3px tall, 1460 flips to the
footer at 711px.

**The strip shrinks but must not grow.** `flex: 1 1 513px` on it opened a
327.5px void at 1440 and 135.5px at 1024 between the last mora and the
rankings, because the table inside never fills its box — the cells carry a
fixed 48px. `flex: 0 1 513px` lets the rankings take the slack instead, which
also gives them two columns at 1024 rather than one and takes another 35px off
the document there.

**It mostly closes the 760–1024 cost but does not erase it.** Against `87727a6`
that band is now +63px at 1024 and +174 to +177px at 760/768, where it was +203
and +280. What is left is the three tables wrapping at 768, which no footer can
help, and the rankings having moved into this panel at all.

Robustness, measured rather than assumed: a fresh profile drops the column
entirely — `App.tsx` passes `aside` as `undefined` when neither ranking has
anything to say, because as a footer an empty wrapper would otherwise claim a
whole flex line. Five long sokuon rankings cost 47px at 768 and nothing at 1024
or 1440. With no off-chart moras the strip drops out and the rankings sit alone
at 46.1px. Text enlarged to a 24px root overflows at no width, and at 768 the
footer wraps to two lines.

Making four columns fit at 1440 instead is not worth it. Zeroing the blank
row-header cell's width gives 1374 against 1376; actually removing the cell takes
a 3px border-spacing interval with it, giving 1371. Neither is headroom. Cutting
the column gap to 16px and border-spacing to 2px as well would reach 1308 — 68px
of room, cells and type untouched — but 1308 still does not fit the 992px
available at 1024, so the footer has to exist regardless and compressing the
chart buys one width.

**Only two shapes are allowed: a panel on its own row, and a pair summing to
twelve.** That is what keeps every row full at every width. Between 760 and 1120
a panel asking for 4 or 8 takes the whole row and only `--span-6` pairs, because
a quarter-width panel is only a quarter width when there is a window to spare.

**Twelve tracks are only possible where twelve tracks fit.** Below 760px
`.stats-grid` is a single `minmax(0, 1fr)` track and `.stats-grid > .panel` is
`grid-column: auto`; the twelve-track template and the `span 12` default are
declared from 760 up. The column gap is `--space-7`, 28px, and a twelve-track
template has eleven of them — 308px of gap against the 288px a 320px viewport
leaves after the page padding. The `minmax(0, …)` floors then let every track
collapse to zero, so a `span 12` panel measured exactly 308px, the gaps alone,
and pushed the document to 324px against a 320px window. **Tracks that can
collapse to nothing hide the gap arithmetic until the gaps are all that is
left**, which is why this survived every wider breakpoint. A `span` wider than
the template would regenerate those implicit columns, so the narrow default has
to drop the span as well as the template. The overflow predates the layout
rework: `87727a6` scrolls to 324px at 320 too.

**Check the row ends after moving any panel between groups.** Changing spans
without reordering the panels left every row ending in a gap, since the calendar
could not follow the chart. Later, moving the key board out of "recent progress"
left the calendar with nothing to pair with and opened a **510px gap at 1024**
that none of the spans themselves were wrong about. The panels are chart,
calendar, milestones; then keys, bar-list stack.

**The romaji key panel sits in "typing mechanics", where the opening
specification above always said it belonged.** It spent a while under "recent
progress", which is the group about improving, while the spec assigned romaji
keys to the group about fingers. The two bar lists are capped at five rows each
and stacked beside it: as a full row of their own they took the width of the
group while the board, which at least points at a key, had none of it.
Changing the spans without reordering was tried first and every row ended in a
gap, because the calendar could not follow the chart.
A heading and a gap already say where one section ends; drawing a box around
every one of them made the page look like a form. This went through cards, then
hairline-separated cells, before landing on plain space, which is what the
reference does too.

The **五十音 chart uses the theme colour for "seen, never missed"**. It was plain
white, indistinguishable from an unstyled cell, so the one state worth being
pleased about read as "nothing here". Three states now: green you have, red you
are getting wrong, outlined you have not met.

The **keyboard keys are square via `aspect-ratio`, never via the width token**.
`--mk-key` contains a percentage, and a percentage resolves against the axis it
is used on — so feeding the same token to `width` and `height` gave a correct
width and a collapsed height, 64px by 23px, which read as slabs rather than keys.
The rows are centred and **not staggered**: with only the three letter rows an
offset read as three misaligned strips, and every way of expressing it fought the
width the keys were sized from.

Two traps here, both of which cost real time:

- **The route gets the whole window.** `app--wide` raises the shell to
  `--stats-max` on this route only; widening it globally would spread the
  practice line and the top bar, and reading content is worse for being wider.
  The mastery chart's three grids sit side by side, not stacked — stacked they
  ran 26 rows deep inside a panel whose chart used a quarter of its width.
- **Span rules must out-specify the single-column default.** `.stats-grid >
  .panel` is two classes; a bare `.panel--span-4` is one, so it loses at every
  width and nothing spans. The overrides are written `.stats-grid > .panel--span-N`.
- **A stale Vite dev server can serve an empty stylesheet.** After many HMR
  cycles App.css came back as a zero-byte style tag, so *every* rule appeared not
  to apply and several correct edits looked broken. If a rule that used to work
  stops applying, check `document.styleSheets` sizes before editing the CSS —
  restarting Vite and clearing `node_modules/.vite` fixed it.

### Themes

A palette swap and nothing else: every colour comes from the tokens in
`index.css`, so a theme redefines those and no rule elsewhere needs to know. The
five colour literals that were left — all in the tooltip and one mastery cell —
became tokens first, because a literal is exactly what a theme cannot reach.

**`system` is the default and is not a palette.** It sets no `data-theme` at all,
so the `prefers-color-scheme` block answers and the app follows the desktop
without a reload; only an explicit choice pins it. That means the dark values
appear twice, in the media query and under `[data-theme='dark']` — deliberately
one palette written in two places rather than two palettes that can drift.

**Four themes, and the values are chosen rather than inverted.** Inverting a
palette moves every hue and lands the accent somewhere nobody checked, so each
pair is measured against its own background.

`dark` is **black and gold**. Gold is an accent and never body text — `#d4af37`
reads 9.3:1 against the page, but gold *as text* fails at small sizes, so the
text token is a warm off-white and the gold carries lines, marks and the brand.
`book` is warm paper and rust ink, for reading at a desk rather than in the dark;
the warmth runs through the whole scale, because a grey page with a warm accent
dropped on it does not read as paper. Its border is held a shade darker than the
page would suggest — a border that tracks the background upward stops separating
anything. The reference has a `sepia` theme built the
same way.

`system` resolves to light or dark only — the OS has no way to ask for the
others.

Measured on **rendered pixels**, because `color-mix` and translucency mean the
computed value is not what the reader sees:

| | light | dark | book |
|---|---|---|---|
| body text | 15.0:1 | 15.8:1 | 11.5:1 |
| muted text | 5.6:1 | 9.5:1 | 6.8:1 |
| **dim text — the untyped romaji** | 4.5:1 | 5.7:1 | 4.8:1 |
| accent as small text | 4.9:1 | 9.3:1 | 4.9:1 |
| button label on accent | 5.2:1 | 9.1:1 | 5.2:1 |
| kana on a weak cell | 9.1:1 | 6.6:1 | 5.3:1 |
| tooltip, dimmest line | 4.7:1 | 9.9:1 | 4.9:1 |

**Measure the dimmest token, not the obvious one.** `--color-dim` is what paints
the *untyped romaji* — the thing a typist reads most — and it sat at 2.38:1 in
light while `--color-muted` was being checked and passing. Every token used for
text has to clear 4.5:1, and `dim` and `muted` moved together so the two stay
distinguishable rather than collapsing into one shade.

Two measuring traps, both of which produced a false failure here. An in-page
contrast helper that parses `rgb()` returns nonsense for an `oklch()` computed
value — it reported 1.28:1 for text that measures 9.09:1 in pixels. And a
row-by-row scan of a screenshot counts the tooltip's **border** as its dimmest
text: group the rows into bands and ignore the ones only a row or two deep.

### Tooltips

`ui/Tooltip.tsx` is one shared element for the whole page, driven by a signal —
the kana chart alone has over a hundred cells and none of their tooltips are
visible at once.

They were native `title` attributes, which the operating system draws: unstylable
by CSS, delayed, and **absent entirely on touch**. Since the numbers on the kana
chart, the key heatmap and the calendar live only in their tooltip, that made
them unreachable on a phone. The replacement opens on pointer, on `pointerdown`
so a tap works, and on focus — the cells carry `tabindex` for it — and it is
clamped inside the viewport, because the interesting kana tend to be at the edges.

Tooltip text is joined with ` · `. The first segment is the thing being described
and gets its own line; the rest are its numbers, quieter and monospaced. The same
string is the cell's screen-reader text, where the separator reads as a pause.

Visually it is the accent at depth over a blurred and lightly saturated backdrop
— `--color-accent-deep`, not black. The blur is what makes the transparency
legible: without it the kana grid reads as noise behind the text rather than
texture beneath it.

**The quiet line is what limits the tint, not the heading.** Measured on real
composited pixels, the heading is 5.3:1 and the numbers beneath it 4.7:1. Lighten
the tint or thin the alpha much further and the numbers fall below AA while the
heading still looks perfectly fine — which is exactly how this gets shipped
broken. Measure the *dimmest* text, and measure sampled pixels rather than the
declared colour, because a translucent background is not the colour it says it
is. Two escapes: an opaque background under `prefers-contrast: more`, since
translucency costs contrast some readers cannot spare, and no animation under
`prefers-reduced-motion`.

The cells carrying a tooltip use the **ordinary pointer**. `cursor: help` says the
thing needs explaining, when the thing *is* the data.

### The progress chart

`ui/ProgressChart.tsx` draws speed and accuracy as **two plots side by side** —
never one plot with two y-scales. 0–120 wpm and 88–100% have no honest common
axis, and pinning them against each other invents a correlation out of where the
two scales happen to sit. They were stacked and sharing an x-axis, which made
"faster without getting sloppier?" a straight vertical read; side by side, that
correspondence is carried by a shared `hover` signal driving the crosshair,
marker and readout in both plots at once, with the readout naming the run.

Speed starts at zero. **Accuracy cannot**: a competent typist lives in a
twelve-point band, and on 0–100 that is a flat line saying nothing. `accuracyFloor`
rounds down in fives with headroom below the worst run, and the axis is always
drawn with its ticks — a truncated scale is honest when it is labelled and
misleading when it is not.

**Runs are compared only within a cohort.** `cohortOf` keys a run by source *and*
mode *and* timed duration, because the banks differ in difficulty by construction
and `drills` deliberately serves the moras you are worst at — a line from a drills
run to a quotes run asserts a comparison that does not exist. Smoothing does not
repair this: it reduces noise, it does not make unlike tasks alike. The default is
the **latest** run's cohort, not the largest, or the page would answer a question
about practice the typist may have stopped doing.

Raw runs are drawn as dots behind the five-run rolling median. The smoothing is a
claim, and the reader should be able to see the evidence for it.

### Reading the page

Hierarchy comes from type and space, not boxes — but it has to *exist*. Group
headings (`h2`) are 18px and dark; panel headings (`h3`) are 14px and dark; only
captions and axes are muted. The group-heading rule is scoped **`.page
.stats-group__label`**, because `.page h2` is a class plus an element and
out-specifies a bare class: unscoped, the whole rule lost the cascade and group
headings rendered at 16px/500 *against* panel headings at 14px/600 — the
hierarchy inverted, and the page read flat for it. That is the second time this
exact pair has bitten; the stats-grid spans were the first.

**The third was `.stat-grid__rank b`.** It ties with `.stat-grid b` — one class
plus one element each — and the base rule is declared below it, so the base won
on source order and the weakest/slowest rankings rendered at 26.25px in
`--font-mono` instead of 16.875px in `--font-jp`. It looked plausible because a
mono stack falls through to a Japanese face for kana, so the glyphs were right
and only the size and metrics were wrong. Written `.stat-grid .stat-grid__rank b`
now. **A modifier that shares a base's specificity is not a modifier**; scope it,
or it is decoration waiting on source order.

A meter is a magnitude, not a verdict: `meter--error` for confusions, which are
mistakes, and `meter--neutral` for latency, which is neither good nor bad. All of
them were accent, so a list of errors read as green-for-good. The "YOU" avatar is
gone for the same reason — it was the page's strongest teal object and carried no
state at all.

The top bar **bleeds past the content column** toward the window edges. Held to
`--container-max` like everything else, the brand and the counters read as
huddled toward the middle with empty margins either side. The bleed is clamped
against the space actually available, so it is zero as soon as the window is no
wider than the column and can never push the page sideways. When both levels were small muted uppercase the page
had no hierarchy at all, which is what made it read as bare rather than clean.

**Colour means state.** Teal is "known" — a clean mora, an active practice day, the
selected cohort, the trend line. Red is "missed" — weak moras and key errors.
Neither is decoration: every overview number used to be teal, which spent the
page's only signal on ornament, and the key heatmap faded *teal* for errors while
teal meant clean two sections above.

The mastery chart is the page's subject, alone on its row, and **that one row is
allowed to be wider than the column** (`stats-group--wide`). Everything else
stays in the column: letting every row reach the window edges made the page read
as scattered rather than as one surface. The bleed is clamped against the space
actually available, so it is zero once the window is no wider than the column.

**Slow-mora information lives on the chart, not beside it.** Each cell already
carries its own excess in its detail; the ranking is what a grid cannot show. A
separate column chart was tried and removed: it restated in a second surface
what the chart's own cells already hold, and earned none of the width it took.

**The rankings live in the chart's margin, not in the legend.** A legend says
what the colours mean; "weakest: のだでさろ" says what the chart *found*, which is
a different job. It was built as the column to the right of the three grids,
holding the off-chart strip and the two rankings — but `.mastery` is
`flex-flow: row wrap` and the aside is its fourth item, so **below about 1500px
it is a centred strip beneath the tables and not a margin at all**. The 537px
hole it was meant to close, and the 370.5px and 206.8px it was recorded as
leaving, all came from comparing heights of children that do not share a flex
line. The measured table is in the stats-page layout section above. The one real
void is 306px under the short `voiced` table on line one, and it costs the
document nothing, because the two 613px tables already set that row's height.
The rankings are set in
`--font-jp` at the chart's own size, because a run of bare kana is the value
itself there and not a label.

The progress plots, the key heatmap and the calendar pair off in rows beneath.
Confusions and bigrams — the only surfaces left that cannot name a mora — come
last, and are shown rather than folded. A disclosure asks the reader to decide
whether something is worth opening before they can see what it is; last place
already says "secondary" without hiding anything.

**The heatmap's caps share their form with the practice keyboard, and nothing
else.** They were a porcelain laptop board and a grid of flat pink rectangles —
the same object drawn in two visual languages, in one app. The cap now takes the
board's corner ratio, its single lower-edge bevel instead of a four-sided
border, and `--font-keycap`. Colour crosses in neither direction: the fill here
*is* the data, so it takes none of the deck's gradient, and the practice board
must never take this tint — a per-key mastery heatmap there is in "Deliberately
not built", because `n` alone types な に ぬ ね の and ん and a tinted cap cannot
name the mora at fault. Sharing a cap shape is exactly the move that would
quietly undo that, so the line is drawn deliberately: same cap, different fill.

The outline is a `box-shadow` ring rather than a `border`, because the bevel is
also a shadow and the weak state needs to tint the ring. Two borders cannot
coexist; three shadows can.

The radius is **bounded, not purely proportional** — `min(28%, 11px)`. 0.28 of
the cap is the board's ratio, but these keys render up to 56px against the
board's 33px, and the bare ratio came out as pills rather than keycaps. Small
caps keep the proportion, large ones keep the look, which is the thing being
matched.

Measured on composited pixels after the change, sweeping `--mk-heat` across its
full 0→1 rather than trusting the fixture (whose keys only span 0.031–0.095, so
it never exercises the range): the ramp is monotonic in all three themes, light
0.8456→0.3104 and book 0.8059→0.2420 falling, dark 0.0173→0.1476 *rising*, which
is correct on a dark page. Dark's luminance spread is much narrower, 0.13
against light's 0.54, but it reads clearly because that ramp moves in saturation
as well as lightness — which is the limit of a luminance-only measurement, not a
fault in the ramp. The bevel cannot muddy the fill: `0 1.5px 0` has no blur and
no spread, so it is the cap's shape offset down and drawn behind it, rendering
entirely in the gap between rows. Measured delta at the fill is 0.0000.

**The key heatmap follows the kana chart's palette exactly**: a key you have
never missed is the same light teal as a clean mora, and one you miss is the
error colour ramped by how badly. Two states, not a blend — compositing red over
teal reads as muddy brown on screen, because the hues are near enough to
complementary that mixing them lands on grey, so the worst keys looked dirty
rather than wrong.

**The calendar is bounded, not stretched.** Its day tracks are `1fr`, so the
cell size used to be whatever column the panel landed in — 53.2px in a half,
87px across a full row — which made the least actionable panel on the page its
loudest object and tied cell size to a breakpoint. A `max-width` on `.calendar`
decouples the two: 28.7px cells at 1440, 1024 and 768 alike, shrinking only when
the column is genuinely narrower than the block.

The calendar labels every row with the day it starts. It had been unlabelled
squares whose only date lived in a `title`, so it said "you practised sometimes"
and nothing a reader could place in time.

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

**Open bug, pre-existing: the chart's cells do not react.** `MasteryMap`
captures `stat` and `state` once while rendering each cell, so a cell drawn from
stale stats stays stale while the route is open. It does not show up in normal
use, because stats do not change while you are looking at them — it needs a run
to complete with the page already open. Found by review, left alone: fixing it
means restructuring the cell body into accessors, which is not a restyle.

**Accuracy gets the colour; timing goes in the tooltip.** See "Deliberately not
built" for why speed never gets a channel of its own here.

Moras that are tracked but have no cell — sokuon, in practice, since 五十音 has no
square for っこ — are rendered in an "also tracked" strip driven by what has
actually been met. Dropping them would let the weakest-kana line, drawn from the
same table, name a mora as your worst and then show it nowhere. They carry their
spelling too (`romajiFor` gets `kko` from the tokenizer): a folded form is
exactly where a learner is least able to supply the romaji themselves.

**The colour is weakness, not accuracy, and the palette transfer is separate from
the statistic.** `smoothedErrorRate` is right for ranking — it distrusts one miss
on one attempt — but its caution compressed the display: pulled toward the prior,
a mora missed on all four attempts scores 0.75 and ten from ten only 0.875, so
the top of the tint was unreachable at any real count. `severity` saturates at
that 0.75 so the ramp is spent on the range that occurs. It stays absolute, never
relative to the current worst — a kana must not change colour because a different
kana entered the table. Say "weakness" in the copy, not "accuracy"; the plain
rate belongs in the cell's own detail.

**Accessibility is a requirement of this surface, not a polish pass.** Real
`<table>`s with `<caption>` and scoped headers, so a screen reader gets the row
and column of every cell — not `role="grid"`, which promises arrow-key navigation
this does not implement. Every cell carries its full status as visually hidden
text, because the stats once lived only in a `title` tooltip: invisible to a
screen reader and unreachable on a touch screen, which is most of the timing
model simply gone. Nothing in the copy may promise hovering. Weak cells carry a
dot as well as colour, since colour cannot be the only carrier (WCAG 1.4.1), and
the legend shows the dot or it teaches the wrong thing. Timing has its own
"slowest moras" panel, which is where excess latency is visible to everyone.

CSS uses `color-mix(in oklch, …)`, which older browsers drop **whole
declarations** for. Every such rule is preceded by a flat `rgb()` fallback using
`--color-error-rgb`; without one, a weak cell silently loses the only signal the
map exists to show.

Known gaps as the corpus grows: katakana and ー reach `isMoraToken` but not the
token model, so the regex is ahead of what is really supported; ー should not
become its own bucket, since its sound depends on the mora before it. The
"also tracked" strip is one horizontal row and is at **nine** off-chart moras
after the bank expansion — still one row, verified, but the table needs 513px to
draw it, and that width is what costs the 760–1024 band its height. It will not
survive many more.

**Do not enumerate the off-chart moras with `grep -oP 'っ.'`.** That matches っ
plus one character, so it truncates the three-character yoon sokuon: っぴょ comes
back as っぴ and っしょ collapses into っし, yielding a confident "eight" that
contains one mora which does not exist and misses two that do. This file said
eight for exactly that reason. Count from the engine instead — `chartMoras()`
against a corpus built from `allBankItems()` and `itemMoras()` gives **104 chart
cells, 113 corpus moras, nine off chart, no unreachable cell**. Chart groups are hardcoded, so a new `KanaGroup` needs adding in two
places. Corpus-wide invariants read `allBankItems()` rather than a hand-listed
set of banks, so a bank added later joins them by existing.

### The practice keyboard

**One board, not two.** There used to be a `mac` layout and a `windows` layout
behind a `KeyboardLayoutName`, a guard, a persisted preference and a settings
picker. Nothing a typist presses during practice differs between them — romaji
is letters, and the only rows that actually diverge are the function row and the
modifier row, neither of which is touched in a run. The split cost five pieces
of machinery and bought a difference nobody typing could feel.

The combined board takes a **glyph** where the platforms disagree on the word
(⌫ ↩ ⌘ ⌥ ⌃ ⇪ ⇥ ⇧) and the **shared word** where they agree (tab, caps lock,
shift, control, option, fn), with the word set under the glyph the way an Apple
keycap reads. The bottom row is the MacBook order — fn · control · option ·
command · space · command · option · control — which is the laptop arrangement
with the arrow cluster replaced by a second control key, putting `fn` in the
bottom-left corner where a laptop has it. Arrow keys are not drawn: nothing in
the app uses them, and drawing a cluster nobody presses is what made the board
read as a desktop keyboard with a bite taken out of it.

**`KEYBOARD_LAYOUT_KEY` outlives the preference on purpose.** Nothing reads or
writes it, but it stays in `ALL_PREFERENCE_KEYS` so a reset still clears it off
profiles that already hold the value. Dropping it from that list looks like
tidying and is the opposite: the dead key would then survive the one action
whose whole job is to erase everything.

**Retiring the field needed no `BACKUP_VERSION` bump**, and the reasoning is the
mirror of why `mode` did need one. A version bump exists for a reader that would
*misread* a file — a v1 reader given a v2 file took every timed run for a
passage run and polluted personal bests with it. A retired preference carries no
measurement. `parsePreferences` falls back per field, so a file written before
the removal loses a setting that no longer exists, and an older build reading a
file written now finds the field absent and defaults it, exactly as it would for
a profile saved before the field existed. Neither reader is wrong.

**The geometry is the part that breaks silently.** Every row is exactly
`ROW_WIDTH_U` (15u) and `keyboard-layouts.test.ts` asserts it, because the frame
is a fixed pixel width — `NATURAL_WIDTH` in `OnScreenKeyboard.tsx`, scaled by a
ResizeObserver — and a row that doesn't sum to 15u overflows the case or leaves
a ragged right edge. The mockup this board came from shipped with exactly that
bug: `padding` on the edge modifiers fell *outside* `flex-basis`, so every row
ran 0.17u long per edge key. `box-sizing: border-box` is what fixes it, and it
is restated on `.kb__key` even though `index.css` sets it globally, because the
flex-basis arithmetic depends on it. Measured in Chromium after the rebuild: all
six rows 556.17px, spread 0.00px. Changing the deck padding changes
`NATURAL_WIDTH`; they are two halves of one number and must move together.

Three details carry the laptop silhouette, and all three are cheap: the
**function row at 0.56 height**, the **home-row nibs** moulded into `f` and `j`
(decorative, but they mark the hand position the app is teaching), and a
**wider bezel with a larger corner radius** than a desktop board, which with the
tight gap makes the caps read as one continuous field rather than separate
tiles. The cap bevel is a `box-shadow`, never a border: a border on four sides
reads as an outlined tile, where a single lower edge reads as a cap standing
proud of the deck.

**The keyboard's surfaces are four tokens, chosen per theme.** `--kb-deck-top`,
`--kb-deck-bottom`, `--kb-cap-top`, `--kb-cap-bottom`, plus `--kb-cap-edge` and
`--kb-cap-gloss` for the mouldings. Text comes from `--color-text` and
`--color-muted` like everything else, so only what a flat background token
cannot express gets its own name. The light and book values are "Porcelain" —
warm off-white caps on a slightly darker warm deck, which is what makes the
board read as a physical object resting on the page rather than another panel
drawn in it. Dark gets a graphite counterpart rather than the same cream, and
that is not inversion-for-its-own-sake: a porcelain keyboard on the black-and-
gold page would be the brightest object on screen and would outrank the kana
line it sits beneath. Measure against the background each one actually has.

A pressed cap loses its bevel and drops into the deck, because that is what a
key does. Tinting alone read as a highlight rather than a press.

**Keycaps are drawn Latin-first — the keyboard was where a whole-app bug showed
up first.** A Japanese font maps U+005C, backslash, to a **yen sign**: a
Shift-JIS legacy where byte 0x5C was ¥ in JIS X 0201, and the fonts still carry
the mapping. The `\` cap rendered as `¥` while its DOM text was a perfectly
correct backslash, so a test asserting on `textContent` passed and a dump of the
rendered labels printed `|/\`. Only looking at the pixels found it. See
"Typography" below: the fix is now the root font rather than a keycap patch.

The repeatable check, since no unit test can see a glyph: draw the two
characters to a canvas in the stack under test and compare the data URLs. Under
a Japanese-first stack the bitmaps for `\` and `¥` are identical; under
`--font-ui` they are not. The general lesson is the one this cost an exchange to
learn — **for anything about rendering, assert on pixels, not on `textContent`.**

### Typography

Three font roles, named for what they are *for* rather than what they look like.

- **`--font-ui`** — the root font, inherited by almost everything. Latin
  families first, then the Japanese families appended as fallback.
- **`--font-jp`** — Japanese-first. Used by `.kana-line` alone, the large
  display type where the Japanese face is the subject and its metrics matter.
- **`--font-mono`** — the typing target, `code`, the paste box, `kbd`, every
  numeral, and the romaji annotations and character diagnostics.

**The root font used to be the Japanese-first stack**, which meant every Latin
string in the app was being drawn by a Japanese face — the yen bug above was one
visible symptom of an app-wide condition, not a keyboard quirk. Latin-first at
the root is what actually fixes it.

**The Japanese families are a fallback tail on `--font-ui`, not a second opt-in
class, because the hard case is mixed strings.** A tooltip heading is
`しゃ · 3 misses` and a result chip is `ど 4 misses`: Japanese and Latin inside
one text node with no element to hang a class on. Per-character fallback handles
that; a per-element rule cannot.

**Mono means "what the user types, and the spellings being taught".** The
practice line, `code`, the paste box and `kbd` are literal input. So are
`.mastery-cell small` and `.still-weak__chip small`, which teach the romaji a
learner must press, and `.bar-row span`, which holds confusion pairs and
bigrams — character diagnostics, not labels. A confusion pair is **romaji**,
built at the keystroke as `${legal.map(label).join('/')} → ${label(typed)}`, so
it reads `h/i → x`; this was once written here as `ふ→ほ`, a label the app
cannot produce, and a screenshot fixture had been built to match the error. Note that
`.mastery-cell--label` is the chart's row/column headers, *not* the spelling
under a kana; the two were conflated once and it sent a plan at the wrong
element.

Chrome — nav, buttons, pills, brand, hints, loading text, chart cohort labels,
result meta — carries **no `font-family` at all** and inherits `--font-ui`.
Deleting the override is the whole change; re-stating the token on each rule
would just be a second place to drift.

**Numerals are still mono, deliberately, and moving them is a separate job.**
`font-variant-numeric: tabular-nums` is not the guarantee it looks like. It does
nothing about a digit *count* change — `9 → 10`, `99 → 100` — and it is not even
reliable per digit: measured in the installed font, Segoe UI Semibold 5.65
normalises every digit to 1137 units under `tnum` **except `7`, which stays at
1098**. The app uses `--fw-semibold: 600`, so that face is reachable. Verify
rendered advances at the weights actually used before moving any numeral.

**Known limit, measured rather than assumed:** `--font-ui` and `--font-jp` do
not always resolve kana to the *same* Japanese face. On a Linux box with the
Windows fonts installed, `.kana-line` renders しゃ in Yu Gothic while chrome kana
resolves elsewhere through the fallback tail. Both are real Japanese faces and
neither is tofu — the width is identical — but they are not the same face. On
macOS and Windows the leading Latin families carry no kana, so the tail is
reached and both agree. If the mismatch ever matters visually, the correct tool
is an `@font-face` with a CJK `unicode-range`, not reordering the stack —
putting the Japanese families earlier is what caused the yen bug.

### The practice toggles

`Settings` defaults are chosen, not inherited, and each has a reason.

**`confidenceMode` (off).** Backspace does nothing, so every keystroke commits.
Off by default because this matcher already refuses wrong keys: a typist who can
neither take a key back nor push a wrong one through has no way out of a
half-assembled mora. The two together are a wall, not a discipline. The keydown
handler still calls `preventDefault` on Backspace whether or not the mode is on,
or the browser navigates back out of the app.

**`whitespaceMarkers` (on).** A faint ␣ over each space in the romaji line. On by
default because the space is a key you have to press and the kana above it shows
no gap at all — 写真 and 友達 sit side by side while the romaji demands
`shashin tomodachi`. Drawn as an overlay rather than substituted for the
character, so the space keeps its own width and the correct/incorrect colouring
underneath still reads.

Both are read by the same per-field fallback as every other setting, so a profile
written before they existed keeps its own values and takes the defaults for
these — rather than being rejected, or having them invented as off.

### Run modes, and what may set a record

`RunResult.mode` is `{ kind: 'passage' } | { kind: 'timed'; durationMs }`. It is
optional, and **absence means passage** rather than unknown: every run recorded
before time mode was one. A stored mode that cannot be interpreted also reads as
passage rather than dropping the run — the rest of that record is still good data.

`isProgressionEligible` is the single place deciding what may set a personal
best, unlock a source, or join the speed distribution — rather than a `run.mode`
check at each of the sites that care. A passage run always counts, however long
its passage: those already run from three items to thirty across different
sources and error settings, so length was never what made them comparable. A
timed run counts only at `STANDARD_TIMED_MS`, because a fifteen-second sprint and
a sixty-second run are different tests, and pooled the shorter one takes the
record for reasons that have nothing to do with typing. **Every run still counts
toward mastery, totals, sessions and streaks** — this gates ranking alone.

A timed run may legitimately have `chars: 0`: the clock can run out while the
typist idles, or every key they pressed may have been refused and so never
entered the line. Validation allows zero *only* for timed runs, since reaching
the end of a passage cannot happen without typing.

**Backup is v2.** The bump is not for our own reader — `mode` is additive and
absence is well defined — but for a *v1 reader given a v2 file*. It would drop
the field it does not know and read every timed run as a passage run, quietly
polluting personal bests with a measurement never comparable to them. Refusing a
file it cannot interpret is the entire purpose of carrying a version. v1 files
are still read here, because nothing in one is ambiguous.

### Dealing across passages

`dealRandom` shuffles a fresh deck inside every call, so its guarantee — every
item dealt once before any is dealt twice — held only *within* one call. That was
invisible while one deal filled one whole run. Deal twice and an item can repeat
across the boundary while others in the bank are never seen, which is the
clustering dealing exists to prevent, moved up one level.

`newDeck` and `dealFrom` carry the deck between calls, so the guarantee holds
across a run of several passages. `dealFrom` returns a new deck rather than
mutating the one it was given.

Note for testing this: an aliasing bug here is invisible over a *fresh* deck,
because the empty `remaining` is replaced by the reshuffle on the first
iteration. A test of "leaves the deck untouched" has to use a part-dealt deck or
it cannot fail — one written the easy way passed against an implementation that
aliased the caller's array outright.

### Time mode

Off by default, and one duration only (`STANDARD_TIMED_MS`) — two durations are
two different tests, and pooling their speeds would let the shorter one own the
record.

**The engine owns the deadline; the UI owns the scheduling.** `remainingMs` is
pure arithmetic and nothing in `engine/` holds a timer. The clock starts on the
first keystroke, not on page load: a run you have not begun is not running out.

Three things the deadline has to get right:

- **`finishRun` is given the deadline, not the moment the callback fired.** A
  timer that runs 400 ms late would otherwise record a 60.4-second run and every
  timed run would be a different length. Verified end to end in Chromium:
  `elapsedMs` comes out at exactly 60,000.
- **It is checked synchronously before every keystroke**, not only by the timer.
  A throttled or backgrounded tab fires timeouts seconds late, and without the
  check the typist keeps scoring into a run that is already over.
- **The timer is cancelled with the run**, alongside the result-navigation timer.
- **The result screen appears only if the typist is still on practice.** A
  deadline can land while they are reading their statistics, and pulling them out
  of that page into a result they did not ask for is the same rudeness the
  completion timer already avoids after a restart. The run is saved either way;
  if they were away, practice is reset so returning gives a fresh passage rather
  than a finished run they cannot type into.

When the passage runs out before the clock, that ends nothing: `rollToNextPrompt`
clears the matcher and the line, the run's counters and stat tables carry on, and
`refill` deals the next passage. A `RunPlan` is what makes that honest — it
resolves the source **once**, because `auto` picks a bank per call and one timed
run would otherwise wander across words, drills and quotes while `RunResult`
records a single source, and it carries the deck so consecutive passages cover
the bank instead of restarting the shuffle.

### A run is not a passage

They used to be the same thing, and `finishedAt` quietly meant both "the matcher
reached the last token" and "the run is over and rejects input". That held only
because one passage had always been one run. A timed run outlives its passage, so
`SessionState` now has two kinds of field:

- **Passage-local**, reset when the passage is replaced: `keys`, `match`,
  `pendingKana`, `timingBlocked`, `carriedMiss`, `rejected`, `lastKeyAt`.
- **Run-wide**, carried across: `attempts`, `mistakes`, `startedAt`, the three
  stat tables, `intervals`, `cleanIntervals`, and `completedChars` /
  `completedCorrectChars`.

`rollToNextPrompt` performs that split. `keys` was doing two jobs — the line on
screen *and* the run's character count — so the count is banked into
`completedChars` before the line is cleared, and `computeMetrics` and
`buildRunResult` read the banked totals plus the current passage. `lastKeyAt` is
cleared, because dealing and painting the next passage is not typing: charged to
the first keystroke of the new passage it would land on that mora and make
whatever came first look hard in every timed run.

`finishRun` has to resolve **two** things the model is holding but has not written
down, both of which it used to throw away:

- **A mora that is finished but not moved off.** "Pending" is not "half typed":
  after `a` in あか, あ is complete and only waiting for か to begin, because
  nothing has been pressed since. `pendingKana.complete` records that, and a
  deadline landing in the gap keeps the mora. One genuinely mid-spelling is still
  not an attempt.
- **A carried miss.** It belongs to the mora that had not opened yet, and the
  screen said so at the time — so `carriedMiss` carries the token, not a boolean,
  and the miss is banked against it. The clock stopping does not undo a mistake
  the typist made.

`finishRun` ends a run wherever the typist is. Passage completion never needed
it — the run ended at a point where the final mora had just been banked — but a
deadline lands anywhere, frequently mid-mora. **The cutoff is never evidence**: a
mora interrupted while clean is not an attempt, because stopping a clock says
nothing about whether the typist knew it. One that already carries a miss *is* a
real encounter and is banked, with no duration, since a truncated mora was never
timed. Without this, a genuine miss in the last second vanished, breaking the
rule that what the screen blamed is what the table records.

Rejected on the way: **appending the next passage's tokens** to the live array
keeps token indices valid but makes `applyBackspace` replay the whole run
(`matchFor` rebuilds from every surviving key), lets backspace reach into a
passage that has scrolled away, and needs the display windowed anyway.
Concatenating two compiled prompts also silently fuses the last mora of one to
the first of the next, since `compilePrompt` only inserts separators *within* a
call. **Merging independently completed sub-runs** fails on a narrower point:
`RunResult` permits one `baselineMs` and `mergeMoraStats` applies it to every
mora in the result, so passages with different baselines cannot be combined
without losing information.

### Finishing a run

A completed run is **saved synchronously, at the moment it completes**; only the
navigation to the result screen is deferred, and that timer is tracked so a reset
cancels it.

Both used to happen in one `setTimeout(…, 0)` that re-read the `session` and
`lesson` signals when it fired. Tab and Enter both restart, so a restart keypress
landing in that window — which ordinary fast typing reaches — reset the session
first and the callback then recorded *the empty session* as the run. Reproduced
in Chromium against the committed build: a finished 52-character run was
discarded and a `chars: 0, wpm: 0` phantom written to the history in its place,
with the app navigating to a result screen to display it. Phantom runs do not
stay contained, either: lifetime totals, averages, personal bests and streak days
are all derived from that same table.

Saving from the arguments rather than the signals is what makes a completed run a
completed run whatever happens next. Cancelling the navigation is separate, and
is about not yanking a typist to a result screen for a run they have already
moved on from.

### The result screen

**No heading.** The numbers say what the screen is, and a title above them only
delays them. Speed and accuracy come first, at roughly triple the size of
everything else — the research figure is that a primary metric wants to be at
least a third larger, and a result screen exists for exactly two numbers.

**No boxes anywhere.** Raw, consistency, misses and time get the same treatment
as the hero, markedly smaller; sections are a rule and a quiet heading. Cards
gave the secondary stats the same visual weight as the score, which is the
opposite of what the screen is for.

Chips carry a **light fill** — a wash of the error colour for a weak mora, of the
accent for a milestone. Outline-only made them read as buttons rather than as
marks on the data. A milestone not yet reached is the exception and stays
outlined, so a target never looks like something already earned. Recurring weak
moras keep their underline, so that distinction survives a red deficiency.

**Milestones show the next one, not only the newly reached.**
`newlyReachedMilestones` fires only on the run that crosses a threshold, so on an
established profile the section appeared once and then never again — a flash, not
a surface. `nextMilestone` gives the screen something to aim at on every run, the
way "still weak" does.

### Closing the loop on the results card

`weakAfterRun` feeds a "still weak" callout on the result screen. Without it the
mastery model was only visible on the Statistics page, which you have to go
looking for — so the app knew what to practise, aimed drills at it, and never
told the typist any of that at the moment they had just finished and were
deciding whether to go again.

Ordered by **lifetime** weakness rather than by misses in this run, because that
is the order drills pull in: the list predicts what the next run will target
instead of restating what this one did. `recurring` separates a mora you keep
failing from one you fumbled once — lifetime totals already include the run being
reported, so having more misses overall than in this run is exactly what "missed
this before" means. It is drawn with an underline and a border rather than a
second fill colour, so it survives a red deficiency and a monochrome screen.

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

**Pasted library text does not need a reading if it is kana.** `derivedRomaji`
spells each character **as written**, which is the honest description and the one
the copy uses: it cannot tell a particle は from the は in はな without
morphological analysis, so きょうはいいてんきです derives `kyouha…` where a
speaker says `kyouwa…`. Particles は, へ and を therefore need the explicit form,
the same as kanji, and the placeholder shows one rather than shipping the error.
Pasting おはよう is enough and pasting 学校 is not —
`tokenizeKana` falls back to one self-spelling token per character for anything
it cannot read, which is exactly the "no reading available" case. Requiring
`かな|romaji` for everything made the obvious action, pasting Japanese, produce
nothing at all.

**And a refused line says why.** `parsePastedText` returns what it rejected and for
which of four reasons. It is named for its input rather than its destination:
`io/persistence.ts` has its own `parseLibrary` that validates *stored* records,
and two functions of the same name doing different jobs on the same data is how
the wrong one eventually gets called. Returning an empty list and nothing else meant the add
button simply appeared not to work.

`MAX_LIBRARY_ITEM_CHARS` is imported by `readLibrary` rather than repeated. As
two literals they drifted, and a long line saved, practised once, and vanished on
the next load with nothing said.

**`|` is the only delimiter.** A double space used to separate the pair too, so
`ねこ  いぬ` parsed as kana `ねこ` with romaji `いぬ` — a second Japanese word
silently reinterpreted as a spelling, stored, and impossible to type. A wide gap
is now just a word break. Ordinary sentence punctuation (！？「」、。 and the
ideographic space) is stripped rather than refused; each mark tokenizes to a
self-spelling token, so leaving it in failed the whole line as "no reading" when
only the mark was unsupported.

No bundled item may pair a **particle は or を with kanji**. The particle is
pronounced wa / o, so typing it as written teaches the wrong sound — but spelling
the reading phonetically breaks the furigana, because `rubySegments` finds the
kanji by matching the shared kana suffix, and けいぞくわ against 継続は shares
none of it. The whole phrase is then annotated and the kana は is glossed as わ.
こんにちは escapes this only by having no kanji to annotate. Every original quote
avoided the combination; two added later did not, and were replaced.

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

**Every source is available from the first run.** `difficult`, `quotes` and
`library` used to unlock at 30, 50 and 70 wpm; the gate is gone entirely, not
zeroed — `sourceUnlockAt`, `sourceUnlocked` and the `unlockAt` column with it,
because dormant gating logic is worse than none. A learner who wants harder
material should not have to earn it at a speed they are not there to chase, and
`library` made the case plainest: it is the typist's own upload, withheld until
they were fast enough to read back what they had already given the app.

The one fallback left is a library with nothing in it, which is real emptiness
rather than a permission. Speed milestones survive as plain achievements and no
longer claim anything unlocks, since nothing does.

The bundled banks are small on purpose but were *too* small: 24 words meant a
thirty-item passage repeated every entry. They are 55 / 33 / 14 now, and the
corpus covers 112 distinct moras with every one of the chart's 104 cells
reachable. Anything added has to pass `compileStrict` — the test over every bank
is what makes that a build-time failure rather than a passage nobody can finish.

`gojuonBank` holds the chart, one row per item, tagged `seion` / `dakuten` /
`yoon`, and backs the `kana` source. Never gate it on speed — a beginner needs
the chart most. It is also excluded from `auto`: the chart is a drill you pick,
not something to be handed unasked mid-word-practice.

Lessons are dealt from a shuffled deck (`newDeck` / `dealFrom`), not drawn
independently — independent draws routinely produced eight copies of one word
while leaving most of the bank unseen. The deck is carried by the `RunPlan`, so
the guarantee holds across a run of several passages rather than only within one
deal.

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
  the 五十音 grid instead, which fits the data almost exactly: 104 of the 113
  tracked moras sit on the chart, every chart cell is reachable from the corpus,
  and the nine outside it are sokuon (っか っこ っし っしょ って っと っぱ っぴょ
  っぽ).
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
