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
them.)

**The column keeps its place; the tables give way.** The three kana tables are
one flex item (`.mastery-tables`) that wraps internally. As four siblings of
`.mastery`, the aside was the last item on the line and so the first pushed off
it, and the rankings and the legend jumped to the foot of the panel the moment
the window narrowed. The tables are a grid of equals and reflow without losing
anything; the column beside them is two fixed things that should stay put.

**The footer's thresholds are content-aware, because the geometry is.** The
three tables and their gap are 909px. The column is 513px with the off-chart
strip and the width of the rankings alone without it, so it stops fitting beside
them at 1422px of panel width in the first case and about 1078px in the second.
`.mastery-aside--strip` carries that distinction from `MasteryMap`, and each
threshold has its own `@container` block. One fixed threshold would either drop
the column early on a profile that has met no sokuon — the common case for a
new learner, and the one that keeps it beside down to a 1140px window — or let
it stand up tall on one that has. 721px is the floor in both.

**Scope each block's child rules to its own threshold.** Written once for both,
`flex: 1 1 12rem` on the rankings reached an aside that was still a column,
where `flex-grow` runs down the page rather than across it: the rankings
stretched to fill the column and the legend's `margin-block-start: auto` was
zeroed, so on a fresh profile the legend sat at the top of the column instead of
its foot. The footer's rules only make sense where the footer applies.

Measured: as a footer the aside is 77.7px tall against 218px standing up, and
the document holds at 2273px at 1440, 2656px at 1024 and 3365px at 768 on a full
profile. On a profile with no sokuon the column stays beside the tables from
1600 down to a 1108px panel — a 1140px window — with `.mastery` at 613.3px
throughout, where a single 1462px threshold dropped it to a footer at 1526.
Phones are untouched: a 358px panel is below the 721px floor. Verified on three
profiles — full, no sokuon, and fresh — at 1600, 1440, 1024, 768 and 390, with
the legend level with the bottom of the tallest table wherever the column
stands.

**The bleed is for the chart, not for the words.** This group is full-bleed, so
its own left edge sits `--group-bleed` outside the column every other heading on
the page starts at — 104px at 1600. Both the group heading and the panel heading
inherited that, and so hung to the left of `your statistics` and of every other
group label: the one thing on the page that did not line up. They now carry
`padding-inline-start: var(--group-bleed)`, inherited from `.stats-group--wide`
so it tracks the same clamp and goes to zero with it. Verified aligned to the
page's `h1` at 1600, 1280, 1024 and 390 — the bleed is 104px at the first and
0px at the rest.

**The chart and its legend share a box only as wide as the chart**
(`.mastery-panel`, `inline-size: fit-content`, centred), so the legend sits
inside the chart's own width instead of ranging across a panel the chart does
not fill. This is why the size container lives on `.panel--map` and not on that
box: an inline-size container is sized as if it had no contents, so a container
on the box would collapse it to nothing.

**A panel description is separated from what it introduces by 32px**
(`.panel > h3 + .muted { margin: 0 0 var(--space-8) }`). `.muted` is a `<p>` and
`index.css` resets `p { margin: 0 }` — nothing is being collapsed away here, the
margin simply is not there — so the content began immediately under the line
describing it. The mastery panel held this margin on its own as
`.panel--map > .muted`; widening the selector gives the key board the same,
where its disclaimer measured 0px above the keys. Scoped to a `.muted`
**directly after** the heading so that a trailing caption, like the milestones'
`N of 9 reached.`, is not given a gap below it that it has no use for.

**Two more gaps that measured zero or near it**, found the same way:

- `.achievement__list + .muted { margin-block-start: var(--space-4) }` — the
  chips and the count that sums them were touching at 0px. The count belongs to
  the chips, so this is the smaller step, not `--space-8`. **Carried by the
  count and not by the list**: the same `.achievement__list` ends the result
  screen's milestone section, where no count follows it and the buttons below
  have their own spacing, so a `margin-block-end` on the list would have moved a
  surface nobody asked about.
- `.bar-list { margin-block-start: var(--space-8) }` — the bars started 16px
  under their heading while the panel beside them began 32px below its own
  introductory line. `--space-8` and not the `--space-4` that would appear to
  close the difference: this margin meets the heading's own 16px bottom margin
  in a block container, where the two **collapse to the larger** rather than
  adding, so 16 changed nothing at all and 20 would have moved it by 4. This
  equalises the step from text to content, not the depth at which the two
  panels open: the key board also has a disclaimer above it, so its keys still
  start lower than the bars.

Together they cost about 46px of page height between 1024 and 1440 (1440:
2273→2319) and about 80px on a phone, where the panels are stacked and the
heading pairs occur more often (390: 4410→4490). No width overflows.

**The legend lives in the right-hand column, at its foot**, not in a row under
the chart. It is reference material rather than a finding, so it belongs where
the eye lands last — and the column's lower half is empty anyway, since the
rankings are short and the tables beside them are 613px. `.mastery-aside` takes
`align-self: stretch` so the column fills the line (`.mastery` aligns its items
to the top, so otherwise there is nothing for an auto margin to work against),
and the legend takes `margin-block-start: auto`. Measured level with the bottom
of the tallest table to the pixel at 1600, on a full profile, a profile with no
sokuon, and a fresh one.

It is free where the margin arrangement applies, because it fills a void that
already existed. Below 1462px of panel width it joins the footer row instead and
costs 33px at 1024–1120, 105px at 768 where it wraps, and 70px on a phone.

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
declared from 760 up. The column gap is `--space-7`, 28px, wherever the window
is narrower than 1120, and a twelve-track template has eleven of them — 308px of gap against the 288px a 320px viewport
leaves after the page padding. The `minmax(0, …)` floors then let every track
collapse to zero, so a `span 12` panel measured exactly 308px, the gaps alone,
and pushed the document to 324px against a 320px window. **Tracks that can
collapse to nothing hide the gap arithmetic until the gaps are all that is
left**, which is why this survived every wider breakpoint. A `span` wider than
the template would regenerate those implicit columns, so the narrow default has
to drop the span as well as the template. The overflow predates the layout
rework: `87727a6` scrolls to 324px at 320 too.

**One row opts into a gutter**, `.stats-grid--gutter` on "typing mechanics",
where the column gap widens on a ramp from 28px to `--space-24`, 96px, at 1440
and holds there:

```css
.stats-grid--gutter {
  column-gap: clamp(
    var(--space-7),
    calc(var(--space-7) + (100vw - 1120px) * 0.2125),
    var(--space-24)
  );
}
```

28px is what the twelve-track template can afford where it first appears —
eleven of them against the 728px a 760px window leaves — but it is not a
separation between two panels that each run their content to their own edge. The
key board's `p` key ended 28px from the `k → l` of "most confused" and the two
halves read as one field of marks.

**Opt-in, not the grid's default, because the gutter is paid for by the panels
beside it and not every row has it to give.** `panel = nW/12 − (12−n)g/12`, so
the narrower the span the more of the gutter it pays: at 1440 a 96px gutter
costs each half of a `span 6` pair 34px (650→616), the `span 8` chart 23px
(876→853) and the `span 4` calendar **45px** (424→379). Nothing in "recent
progress" is crowding its column, so it keeps the 28px gap and its panels keep
their widths. This was tried as a grid-wide rule first and reverted; a gutter
belongs to a row whose two panels crowd each other, not to the page.

**A ramp rather than a second breakpoint.** Stepping straight to the gutter at
1120 would take each half of the pair from 530px to 496 at the width where they
have least to spare, and when the rule was still grid-wide the same step took
the chart panel from 716px to 704px — below the 709.8px its eight cohort buttons
need — and cost the page 34px of height in a band above 1120. On the ramp the
gutter is 28px where the window is narrowest and widens only as there is room.
Swept at 10px steps from 320 to 1600: nothing overflows at any width.

Set `column-gap` alone, never `gap`, so the 24px row gap stays the page's
vertical rhythm. **A `span 12` panel keeps its width across this whole range**,
covering the eleven gaps along with the twelve tracks, so the mastery panel's
container-query thresholds do not move with the gutter. That invariance is not
unconditional: it holds while the tracks have width to give, and a gutter large
enough that eleven of them exceed the container reproduces the collapsed-track
overflow described above.

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

That gap is closed: katakana and ー now reach the token model too, and `MORA` no
longer admits ー, which was the half of the mismatch the regex had wrong — its
sound depends on the mora before it, so on its own it is not a bucket anything
could mean. **Katakana moras are off-chart**, since 五十音 here is hiragana, so
pasting katakana puts カ and コ in the "also tracked" strip. Whether カ should
earn the か cell, a cell of its own, or a chart of its own is open and should be
settled before katakana is encouraged any further. The
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

Two details carry the laptop silhouette, and both are cheap: the **function row
at 0.56 height** and a **wider bezel with a larger corner radius** than a
desktop board, which with the tight gap makes the caps read as one continuous
field rather than separate tiles.

**There were three.** The **home-row nibs** moulded into `f` and `j` were the
third, and Ella asked for them gone on 2026-10-26: at this size they read as two
stray grey marks under two keys rather than as moulding, and the argument for
them — that they mark the hand position the app teaches — was the designer's
argument, not a reader's. Removed in full rather than hidden: the `nib` flag on
`KeyDef`, the `f`/`j` assignment, the `kb__key--nib` class and its `::after` are
all gone, and so is the test that held nibs to those two caps. A flag nothing
renders is worse than no flag, and a test guarding a removed feature passes
forever while meaning nothing. The suite is 600 tests from 601 for that reason.
If they ever come back they come back whole. The cap bevel is a `box-shadow`, never a border: a border on four sides
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

**Pasted library text does not need a reading if it is kana** — either script.
`derivedRomaji` spells each character **as written**, which is the honest
description and the one the copy uses: it cannot tell a particle は from the は
in はな without morphological analysis, so きょうはいいてんきです derives
`kyouha…` where a speaker says `kyouwa…`. Particles は, へ and を therefore need
the explicit form, the same as kanji, and the placeholder shows one rather than
shipping the error.

**Katakana and ー were added on 2026-10-22** and the two bugs behind them are
worth keeping in view, because both were invisible from the outside:

- **ー was in `JAPANESE_PUNCTUATION` and came out as a space.** `らーめん` was
  saved as the two-word entry `ら めん`, and `コーヒー` became `コ ヒ`, which no
  longer matched its own romaji and so was refused as `word-mismatch`. A letter
  had been filed with the marks. It is read now: ー repeats the vowel the mora
  before it ended on, as its own token, so コー types `koo` while the character
  to recognise stays コ.
- **Anything needing the explicit `|` form records no moras at all.**
  `compileStrict` fails when the kana cannot spell the romaji and `compileItem`
  falls back to one token per *letter*, so `カナ|kana`, `学校|gakkou` and
  `こんにちは|konnichiwa` compile to `k·a·n·a` and the like. Every such item has
  been invisible to the mastery chart, including the ordinary kana inside it.
  Making katakana derivable removes one cause; kanji and the particles still
  have it, and the fix is to store a `reading` (the field exists and
  `compileStrict` prefers it) rather than only a romaji.

The katakana table is **mirrored from the hiragana one** at a 0x60 codepoint
offset rather than written out, so the two cannot disagree and a hundred
hand-typed rows cannot carry a typo the sweep would miss. The token keeps the
script it was written in; folding カ to か would decide the chart question above
by accident.

#### Authoring a bank

Spaces in `kana`, `reading` and `romaji` mark **display words**, and the three
strings must split into the same number of them, Nth matching Nth. That is what
puts furigana over the right characters. Three rules follow, and
`prompt.test.ts` enforces all of them over `allBankItems()`:

- **A space may separate typing units. It may never fall inside one.** 行って is
  one word, never `いっ て` — that spells itself `ixtsu te` rather than `itte`
  and records moras い/っ/て where there is い/って. Nothing else catches it: the
  split compiles, its word counts agree, and no character is unsupported. The
  check tokenises the reading with and without its spaces and compares.
- **A particle is its own display word.** は read わ has to stand alone, or
  `rubySegments` prints わ above は instead of leaving it as written.
- **`reading` is what you type, not what a dictionary prints.** Topic は is
  written わ and direction へ is written え, following `こんにちは` in `wordBank`.
  を keeps its own spelling, because it is typed `wo` (`o` is also accepted).

Banks are split by the length of their items, and the split buys exactly one
thing: `phraseBanks` set `LONGEST_PHRASE_ROMAJI`, the bound on how much typing
one passage may be, and `longItemBanks` are left out of it. A sentence in the
wrong group raises that bound for every source using it, `library` included —
whose whole reason for being bounded is that pasted text has no trustworthy
length. The split does **not** change how anything is dealt: `dealLesson` sends
every plan through the shuffled `dealPassage`, so a sentence is shuffled in with
the words exactly like a word is.

`drillBankFromWeakKana` draws from named banks rather than the catalog, on
purpose. Most sentences contain most common moras, so a drill on き drawn from
everything becomes general practice that happens to contain some き.

Write readings by hand and **check them against a dictionary afterwards**, not
the other way round. For `sentenceBank` all thirty-five agreed with kuromoji's
IPADIC readings; the one disagreement was 十分, which the dictionary read
じゅうぶん where the sentence meant じゅっぷん. A word with two readings is a bad
teaching item whichever one wins, so that sentence was changed to 十五分 rather
than arbitrated.
Pasting おはよう is enough and pasting 学校 is not —
`tokenizeKana` falls back to one self-spelling token per character for anything
it cannot read, which is exactly the "no reading available" case. Requiring
`かな|romaji` for everything made the obvious action, pasting Japanese, produce
nothing at all.

**A paste is confirmed before it is saved.** `engine/review.ts` turns pasted
text into `TextReview[]` — one per line, each a list of `ReviewSegment`s — and
the library route shows them with a kana box under every piece. Kanji boxes
start empty; kana boxes start filled with the kana itself. `reviewItem` builds
the `TextItem` from what comes back, **deriving the romaji** — nobody types
romaji on that screen, because the reading is the only thing no rule can
supply.

- **Segments are runs of the same kind of character**, not words. Without a
  dictionary that is the only boundary that can be found honestly: 今日はいい天気です
  comes back as 今日 / はいい / 天気 / です, four pieces to confirm rather than the
  five words a speaker would name. `segmentLine` keeps 々 and 〇 with the kanji
  run, since asking for the reading of the 人 in 人々 alone is the wrong
  question. A dictionary can hand back the same shape with better boundaries
  and the readings pre-filled, and nothing downstream has to know.
- **Segments are joined by spaces, so each is its own display word.** That is
  what keeps the three readers of a reading from fighting: `itemWords` calls
  `rubySegments` per word and it returns early on a word with no kanji
  (`furigana.ts:107`), so a は read as わ shows plainly while 今日 still carries
  きょう above it. Verified end to end — `今日 はいい 天気 です` /
  `きょう わいい てんき です` compiles strictly, records ten moras, and draws ruby
  on the two kanji words only.
- **`rejectReason` in `lessons.ts` owns the four rules**, and both paths use it:
  a paste parsed unaided and a review a person confirmed. They were duplicated
  while there was only one path in, and a rule enforced on one of them is a rule
  the other can break.
- **The reading boxes are sized in `em`, not with the `size` attribute.** `size`
  counts in `0` widths and a kana glyph is about twice that, so a box sized for
  its own three characters clipped them.
- **`Index`, not `For`, for the review rows.** They are edited in place; keying
  them by content rebuilds the input under the cursor on every keystroke.

**Eviction no longer lies.** `saveReviewed` keeps the new entries whole first
and only then trims the combined list. The old code concatenated and truncated,
so a paste of more than `LIBRARY_LIMIT` lines threw away some of the lines just
added and then reported that the *oldest* had made way.

**A passage may not be padding.** `dealPassage` bounds a dealt passage two
ways, both added after a library of one entry was dealt as **the same paragraph
eight times in a row**:

- it never repeats itself — at most as many items as the deck holds;
- it stops once it holds `paragraphItems × LONGEST_BANK_ROMAJI` characters of
  romaji.

`paragraphItems` counts items, which holds while every item is a curated word of
roughly one size; a saved entry can be four hundred characters. The bound is
derived from the banks rather than chosen — the longest bundled item is the
longest single thing the app already hands out — so **no bundled bank can reach
it**: the eight longest quotes come to 180 against a bound of 216, and a test
sweeps every bank at twelve seeds to keep it that way. The deck still reshuffles
*between* passages, so a short bank is covered again and again across a timed
run, just not inside one passage.

**Still open after this step**: a pasted paragraph is saved as one entry per
sentence rather than as one document that can be named, re-practised in order
and deleted in one action.

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

### The library page

It is an index, not a reading surface, so it takes the **wide shell**:
`.app--library` borrows `--stats-max` the way the dashboard does. It does not
reuse `app--wide`, whose top padding is the dashboard's and would change this
page's vertical rhythm for nothing. `.app--library .topbar` zeroes `--bleed` for
the same reason `app--wide` does — the bleed is computed against
`--container-max`, so on any wider shell it is measuring a column that is not
there.

The first attempt capped `.library` at a flat 1000px, which stopped growing at
1100px: from there up the page was a fixed slab with margins that grew to 300px
a side at 1680, and the complaint it drew — "all the content is confined within
a rectangle in the center" — was exactly right. The cap is now the shell's. At
two columns that took them from 484px to 648px at 1440; at the three columns
the page settled on they are **368px at 1200 and 421px from 1440 up**, and the
widening is what keeps the third column from costing the other two. The heading,
the explanation and the paste form stay at the 760px reading measure inside it:
lists want the window, paragraphs do not.

**Three collections, three columns, one row**: bundled sentences, bundled texts,
and your own, in that order. Sentences lead because they are where a learner
starts and they are the longest list; your own used to be a 760px strip under
the other two and is now a column like the rest.

**The way to add a text closes its own column**, as the last row of the list it
extends rather than a pill beside the heading or a button at the foot of the
page. It is `.library-add`: full column width, dashed, `--color-dim`. The dashes
read as an outline waiting to be filled, and the quiet keeps it from looking
like the page's primary action, which an accent pill in a column of plain rows
does whatever its size. The paste form it opens is wrapped in
`.library__compose` at 760px — the page gave up its cap when it took the window,
and a 1300px paste box is not a paste box.

**The form opens where the button was, inside the column** — changed 2026-10-26
on request. It had been a sibling of `.library-columns`, so it opened below all
three: on a 1400px window that put the paste box most of a screen away from the
list it was adding to, and left its own column looking untouched, so the only
sign the button had done anything was the page growing taller. It is now the
inverted branch of `<Show when={addingText()} fallback={…the button…}>` inside
the third `.library-col`. **The 760px cap survives the move and is not
redundant**: a comment written during that change claimed a library column is at
most about 420px and dropped it, which holds only above the 900px breakpoint —
below it the grid is one column at page width and the box measured **867px at
899px**, wider than it had ever been before the move.

**The heading has no mark.** It carried Lucide's `library` (ISC, four book
spines) until 2026-10-26, when Ella asked for it gone; the brand mark in
`Topbar` went the same day, so no Lucide drawing is left in `src/` and
`THIRD-PARTY-NOTICES.md` no longer has an ISC notice to carry. The `em` sizing
and baseline alignment that paragraph recorded went with the icon — one word
needs no layout. Anything inlined from another project's source in future needs
its notice back in that file.

The breakpoints are set by the content, not by taste. The widest thing in the
**bundled** lists is **294px** of Japanese (切符 を 買って から 電車 に 乗ります)
— your own texts are arbitrary and this number does not bound them — and a row
adds 24px of padding, so a column under about 320px starts wrapping sentences.
Two columns clear that from 900px (418px each) and three from 1200px (368px
each); below 900 they stack.

Sampled at 320/390/760/900/1100/1200/1440/1920, then swept in 4px steps from 320
to 420. **Sentences wrap at 320–344 and stop at 348.** An earlier version of
this paragraph said "nothing wraps above 320px, measured at every step", and
both halves were wrong: eight samples are not every step, and the preview has to
give up the 12px row gap and the 9px chevron on top of its 294px, so it needs
about 347px of column before it fits. The wrapping itself is fine — a phone
sentence on two lines is a sentence on two lines — but the guarantee was not.

**The two bundled collections are drawn differently**, because they are shaped
differently — a passage has a title, an opening line and a count; a sentence has
one line. Both as identical ruled rows is what made the page read as a grid of
forty-two identical objects.

The first attempt dropped the passage rules entirely and separated the entries
by 24px of space. **Do not do that again.** Beside two ruled columns the missing
rule read as something failing to render rather than as a decision, and it was
the first thing asked about. The rule is back; the difference is carried by the
row instead — `--space-4` block padding against the sentences' `--space-3` and a
`--fw-semibold` title.

**The chevron sits at the row's right edge in all three columns**, vertically
centred. It briefly followed the passage title instead, because in a column with
no rules it had nothing to sit against and floated half a column from the words
it opens. With the rule back it has something, and three columns putting the
same mark in three places is worse than any one of the placements.

**The scroll box lost its border.** It was defended here as the one functional
edge on the page — it marks where scrolling starts and stops — and that was
true, but four drawn edges beside an undrawn list made the column read as a
widget bolted on next to the other one. What says "this scrolls" now is the
thumb and a `mask-image` fading the last 32px. The row used to be sliced through
the middle of its glyphs at the cut, which read as a rendering fault rather than
as more below.

**The mask must be paired with `padding-block-end: 32px`, and it shipped for one
commit without it.** The mask is on the scroller's border box and does not move
when the rows do, so with no padding the last sentence ends flush against the
bottom edge and is permanently half-faded — not briefly, at any scroll position,
including the end. Scrolling could not reveal it. The padding gives the last row
somewhere to go above the fade. The remaining cost is the inset focus ring on
the row at the cut, which is real but is the small one; the first version of
this note called it the only one.

The fade is off under `prefers-contrast: more` and `forced-colors: active`.
Both modes exist to remove soft edges, and under forced colours the text is
repainted to the system palette with the mask still dimming it.

**The whole row is a `<button>`.** Its children are phrasing content because a
`<div>` inside a button is invalid, so `.text-row__body` is a `<span>` that
happens to lay out as a column. The row carries `padding: var(--space-3)` so the
hover band has somewhere to sit, and `.text-list` is pulled out by the same
amount so the text still starts on its heading's left edge.

**Three risks the bundled fixture hides**, all three closed on 2026-10-24.

**A saved text is not authored content.** `MAX_LIBRARY_ITEM_CHARS` allows 400
characters in one entry and nothing requires spaces in them. `.furigana__word`
carried `white-space: nowrap`, so an unspaced entry was one unbreakable word: a
seeded 100-character entry measured **1686px inside a 421px column and scrolled
the whole page sideways by 1233px**. `word-break: keep-all` on `.furigana` now
forbids the mid-word CJK break that `nowrap` forbade, `overflow-wrap: anywhere`
lets a run with no other opportunity break rather than overflow, and
`min-inline-size: 0` releases the flex item's automatic minimum. `anywhere`
rather than `break-word` on purpose: only `anywhere` lets the break count
toward min-content, which is what stops the item demanding 1686px to begin
with. The 400-character worst case now wraps to 18 lines inside the column with
no page overflow, and the bundled sentences at 320px are byte-identical before
and after — same line counts, same words on the same lines.

**Your own texts is bounded too**, with the same `text-list--scroll`. It was the
one column that could grow without limit — 200 entries is the storage cap — and
unbounded it put the page back where it started. Verified at 200 entries: the
list caps at 520px and scrolls, the page stays one screen, the add button stays
below the scroll region where it belongs.

**A passage row is named by its title**, via `aria-labelledby`, with the opening
line and the count as `aria-describedby`. A button's accessible name is computed
from its content, so without this the name was the whole row — "Moving house 先週
…部屋に引っ越しました 7 sentences". A passage has a title, so there is a right
answer and no need to invent one.

**The sentence rows are deliberately left alone**: they have no title, so their
content is their name, and that is correct. Measured in Chromium, the name comes
back as `今日はとてもいい天気です` — the `<rt>` readings are **not** folded into
it, so the duplication that was feared there does not happen. That is one engine.
[HTML-AAM](https://www.w3.org/TR/html-aam-1.0/#el-rt) does not guarantee it
elsewhere, and nothing here should start hiding `<rt>` globally on the strength
of one measurement: the readings are authored, they disambiguate kanji, and
losing them costs more than a repeated syllable. Test with a real screen reader
before changing it.

**Edge cases closed on 2026-10-24**, after a Playwright sweep and a second
Codex pass. Each of these was reachable, not theoretical.

- **`.review` had no cap.** The page gave up its 760px measure when it took the
  window, and `.review` is a *sibling* of `.library__compose`, not a child — so
  capping the paste box fixed one screen and left the next at **1328px**, with
  the explanation and every reading row stretched across the monitor. Scoped
  `.library .review`, since the class itself is not the library's.
- **`clamp(320px, 52vh, 620px)` was wrong below a 615px-tall window**, where the
  floor exceeded 52vh: at 1440×380 the sentence list was 320px of a 380px
  viewport, **84% of the screen**. The floor is 180px and it holds 52% at every
  height from 346px up. It is **not** "three rows" — 32px of it is the fade
  padding, leaving about 148px, and row height is not a constant once text wraps
  or the reader enlarges it. A floor counted in rows is not available here.
- **Three inputs cleared `parseLibrary` and rendered badly.** A whitespace-only
  entry (`' '.length` is 1, and `' '.split(' ')` is two "words" on both sides)
  became a 60px button with no accessible name; `ne\tko` passed every check
  while Tab restarts a run rather than typing anything; and a `reading: ''` was
  kept as a meaningful reading, beating `reading ?? kana` so `compileStrict`
  tokenised nothing. All three are rejected at the data boundary, not at render
  — a render guard would hide the row and leave the entry in the practice pool.
- **Forced colours left hover with no indication.** The mode replaces background
  colours and keeps their alpha, so the 4% tint resolved to
  `rgba(255, 255, 255, 0.04)` — measured — and the chevron's accent went the
  same way. Hovered rows get `outline: 2px solid Highlight`, the system's own
  colour for this, excluded on `:focus-visible` so it does not fight the focus
  ring.
- **Crossing the page by keyboard was up to 235 tab stops** — 35 sentences plus
  200 saved. Two `.skip-list` buttons, hidden until focused, move focus to the
  texts heading and to the add control. The rows keep their ordinary tab stops;
  roving focus was considered and rejected, because a list of buttons behaving
  like a list of buttons is not the problem. **They are `<button>`s, not
  `href="#texts"` anchors** — this app routes on the hash and an in-page anchor
  would change the route. The destinations carry `tabindex="-1"` and a visible
  `:focus-visible` ring, because focus moving somewhere invisible is worse than
  not moving.

**Swept and left alone**, with the measurement rather than the assumption:
breakpoint boundaries 899/900/1199/1200 and widths to 3440 (no overflow, columns
settle at 421px); duplicate saved entries (no duplicate DOM ids);
`prefers-reduced-motion` and `prefers-contrast: more` both firing; the review
screen still cleared on leaving the route; and the browser's own base font at
150% and 200%.

**That last one needs a note, because the obvious test is wrong.** Injecting
`html { font-size: 32px }` does nothing: `:root { font-size: var(--fs-14) }` in
index.css is one class-equivalent higher and wins, so the page looks reassuringly
stable while nothing has changed. Emulate the browser setting instead — CDP
`Page.setFontSizes` — which is what `rem` resolves against. Done properly the
root goes 15px → 22.5px → 30px and there is no horizontal overflow at 1440, 390
or 320. The layout widths are px, so columns do not grow with the reader's font;
content wraps instead, which is the right failure.

**The 390px half of that is not reliably true, and the flake is older than this
note.** Re-measured 2026-10-26 at a 32px browser default, five fresh loads per
build: the practice screen overflows by **4px on three to four loads in five**,
and by 0 on the rest — identically at `db0ef17` and on the restyle, so it is
neither introduced nor fixed by the top-bar work. No element's box exceeds the
client width when it happens, which points at the on-screen keyboard measuring
itself before the fonts settle rather than at a layout rule. A single clean
sample is what put the unqualified claim here; it wants five before it is
believed again, and the keyboard's measurement timing is where to look.

**Accent on a control is not accent on data.** Teal means "known" on the chart
and in the stats, and that rule holds for anything reporting a measurement. A
chevron that turns teal while the row is under the cursor is reporting the
pointer, not the learner: it is a transient control state, it disappears when
the cursor leaves, and it is the same thing the nav and the focus rings already
do. The row's own fill stays neutral, which is where the rule bites. The step
the chevron takes is off under `prefers-reduced-motion`; the colour is not,
because the colour is the signal and the step is the flourish.

**Restyled on 2026-10-26**, on request, then reviewed by Codex and corrected.
The requests were: the reference brand, the nav at the top centre, the theme
colour on native controls and on focus, the library mark gone, the `picked:`
readout gone, and bigger navigation type.

- **The brand is a tile, a wordmark and a tagline**: `.logo__tile` holding か
  filled with `--color-accent`, `kana.` at `--color-text`, and
  `JAPANESE TYPING PRACTICE` under it. か and not あ, which is where the gojūon
  actually starts — あ is a vowel and draws as one, so at tile size it reads as
  a mark rather than as writing. The tile is plain text in a styled box, not an
  SVG path, so the glyph comes from `--font-jp` and follows that stack. The tile
  takes the accent **and the wordmark does not**, where the old wordmark was the
  accent itself: two accent objects side by side competed. The tagline is
  `0.5625rem`, written in `rem` after it was first shipped as `9px` — a px
  tagline is the one line of the brand that does not grow when the reader raises
  their browser default.
- **The nav is the top bar's middle track**, not a row under the stage. `.topbar`
  is a grid for it: `space-between` centres the middle item only when the two
  beside it are the same width, and the counters are hidden off the practice
  view, so the links slid right on every other screen. `BottomNav.tsx` was
  renamed `PrimaryNav.tsx` to stop the file naming a position it no longer has.
- **`1fr auto 1fr` is not a promise of equal tracks**, which a first version of
  the comment there claimed. An `fr` track has an automatic minimum, so the
  wider outer item opens its own track past the half: measured **-4.2px of drift
  at 700px**, and **-29.5px at 700px with the root font at 24px**. The fix is
  two `em` breakpoints — nav to its own row at 56em, everything stacked at
  42.5em — because `em` in a media query is the reader's own default size and a
  px breakpoint would have held three columns at 700px however large the text.
  The list breakpoints stay px: they are set by a fixed 294px of Japanese.
- **`accent-color: var(--color-accent)` sits on the shared `button, input` base
  rule** in index.css, not on a component. The checkbox tick and the range
  slider's filled track are drawn by the browser in the platform blue, and
  `accent-color` is the only hook they expose — it is the one piece of colour on
  the page no theme could otherwise reach. Inert on `button`; grouped anyway so
  form controls keep one base rule. Note that the UA may adjust the companion
  colours for contrast, so the computed value does not settle what the tick
  itself looks like.
- **Focus on a text field is the accent, carried by the border** plus a 1px
  outline flush outside it. Not a thicker border: `border-width` would reflow
  the text inside the box on focus and shift the kana in the reading inputs.
  `input[type='text']` matched the *attribute*, so the reading boxes — written
  without a `type` — were missed entirely; they carry `type="text"` now and the
  selector also takes `input:not([type])` so the next one cannot fall through.
- **Navigation type went up a step**: `.subnav__item` 13 → 16, `.source-button`
  and `.hint-button` 12 → 14, and `.practice-hints` itself 12 → 14, since the
  row labels and the `N rows` readout inherit from the block and would otherwise
  have been left behind. The `picked: <source>` readout is gone — the active
  button is already accent-coloured, so it only restated it. `N rows` stays; it
  is a count, not a restatement.
- **`addButton?.focus()` was focusing a detached node.** "Skip your saved texts"
  points at the add button, which unmounts while the compose box is open, and
  Solid does not clear a `ref` on unmount — optional chaining tests whether the
  reference exists, not whether it is still in the document, so the call passed
  and did nothing. It now picks `composeInput` while composing. This predates
  the move into the column; the button unmounted there too.
- **`aria-label="home"` overrode the visible wordmark**, so "kana" matched no
  accessible name — WCAG Label in Name. The label is built from the brand
  strings now. The tagline stays out of it: it is a description, and nobody
  would say it.

**Two keyboard defects closed the same day**, both older than the restyle and
both found while reviewing it. They were held back for a decision rather than
fixed in passing, because each changes an interaction rather than a style.

- **The practice route's window shortcuts sat on top of whatever had focus.**
  Tab was prevented on every keystroke, including while a nav button held focus
  — `defaultPrevented === true`, confirmed — so the top bar could be neither
  entered nor left by keyboard from that view. **Tab is now taken from the
  typing capture and from nowhere else.** An intermediate version exempted
  focused controls instead, which left `<body>` still refreshing and still
  going nowhere; that state is reachable, because the result screen's Enter
  starts practice without focusing the new capture, and every following Tab
  then discarded the passage and moved nothing. A shortcut for a field belongs
  to that field.
- **Shift+Tab is never taken**, because it is the supported way out of a capture
  that is focused on load and again after every click on the stage; it used to
  deal fresh text, but nothing advertised that and the hint reads `Tab fresh
  text`. Not the *only* way out, which an earlier version of this line claimed:
  the handler returns early on `event.repeat`, so holding Tab down escapes too.
  That is an accident of a guard written for key repeat, not a route to rely on
  or to document as one.
- **Space and the completed-run Enter went the same way, one round later.** Both
  were still being swallowed from focused controls, which the Tab fix is what
  exposed: once a reader could Tab to the source buttons, they arrived at
  controls that Enter pressed and Space did not. Space is one of the two
  standard ways to press a button, and a finished run turned Enter into a new
  passage rather than the button the reader had aimed at. `onOtherControl`
  carries the test for both, and the capture is excluded **by identity, not by
  selector** — it is an `<input>` and would match the selector it is being told
  apart from.
- **Letters are deliberately not exempted**, which is where this stops. They
  mean nothing on a button, and clicking a source button leaves focus on it
  (the handler calls `stopPropagation`, so `refocus` never runs) — exempt them
  and a reader who picks a source and carries on typing is typing into nothing.
  Measured both ways before choosing: with the exemption, a letter after a
  source click reaches the run and the counters move. Backspace is left alone
  for the same reason, and because it has no meaning on a button either way.
- **The upload control was unreachable by keyboard.** `.file-button input` was
  `display: none`, which takes the input out of the tab order, and that input
  *is* the control — the label only forwards the click. Measured: Tab from the
  paste box went "check the readings", "cancel", then out of the page, never
  touching upload. Clipped the way `.sr-only` clips now, so it keeps its tab
  stop and looks identical. The ring goes on the label via `:focus-within`,
  because the element that matches focus is a 1px box nobody can see and the
  element that is drawn never takes focus itself.

- **Arriving at practice focuses the typing capture, and `navigate` is where
  that happens.** Ella reported it on 2026-10-27 as a black box appearing in
  the nav on the first Tab, and the box was the symptom: once `Tab` was
  narrowed to the capture, every way of reaching practice that left focus
  somewhere else turned the shortcut into ordinary tabbing along the top bar.
  There were three. The nav buttons call `stopPropagation`, so `<main>`'s
  `onClick={refocus}` never ran for them and clicking `practice` left the
  reader holding the button; choosing a text in the library left focus on that
  row; the result screen's Enter left it on `<body>`. Every route change
  funnels through `navigate`, and `refocus` is a no-op off this route, so one
  call there covers all of them and touches no other destination. `hashchange`
  gets it too, for Back and Forward. **Do not fix this by widening the Tab
  shortcut again** — Tab belongs to the capture, and taking it from the nav is
  the keyboard trap that was closed the day before.
- **The focus ring is a base rule in `index.css`, not a component rule.** What
  Ella saw was Chrome's own ring — a black box with a white inner line — on a
  nav that had never been given one. Five component rules in App.css already
  carried `outline: 2px solid var(--color-accent); outline-offset: 2px`, so
  the nav, the brand and the source buttons were the ones that had been
  forgotten rather than the ones needing a new treatment. On
  `button, input, select, textarea` at `:focus-visible`, where a control added
  later picks it up by existing. The text-field treatment in App.css
  out-specifies it (`input[type='text']`, `input:not([type])`, `textarea` all
  score higher or come later), as do the library rows and the chart cells,
  which inset their ring. `:focus-visible` and not `:focus`, or every button
  would be boxed the moment it was clicked. Verified in Chromium: the ring
  measures `rgb(15, 122, 105) solid 2px off:2px` on all four nav items and on
  the brand under keyboard focus, and `none` after a mouse click.

The hover fill is `color-mix(in srgb, var(--color-text) 4%, transparent)`.
`--color-surface` was the first try and it is pure white in the light theme,
which on this warm grey-green page read as a highlighter stripe rather than a
row under the cursor. Mixing the **text** colour in darkens in the two light
themes and lightens in the dark one — the right direction in all three from one
declaration, where a palette fill needs a per-theme value. Not accent: colour
means state here, and a row under the cursor has none. **4%, not 6%**: a shade
off the page, not a block laid over it. In the light theme that is #f5f7f3 to
#ecefeb — enough to follow with the eye, little enough that the Japanese on the
row does not change weight.

**The chevron is drawn from two borders, not set as a character.** The word
"practise" spelled out down both right edges was most of the grid feeling, and
the obvious replacement — a `›` glyph — is whatever size the fallback font
decides, which on this stack is a hairline about 6px tall. A rotated corner is
exactly the size it is told to be. It sits at the row's right edge in all three
columns, as recorded above.

**The scrollbar is the standard properties, and that is all it is.** This file
previously said `scrollbar-width`/`scrollbar-color` were Firefox's,
`::-webkit-scrollbar` was Chromium's and Safari's, and that both were needed
because neither engine reads the other's. That is false in both directions.
css-scrollbars §2.1 and §3.1 say a UA **must ignore** any non-standard means of
influencing a scrollbar on an element where either standard property is set to
anything but `auto`, and Chromium has supported both since **121** — so on a
current Chromium the `::-webkit-` rules were dead from the moment the standard
ones were written beside them. `scrollbar-width: thin` is also what drops the
stepper arrows; `::-webkit-scrollbar-button { display: none }` never did it. The
`::-webkit-` block is kept, inside `@supports not (scrollbar-width: thin)`, as
the fallback it actually is.

The thumb is `--color-dim`, not `--color-border`: border weight is right for a
rule you read past and wrong for the one control in the column, where it
computes to roughly 1.25:1 against the page.

**Headless Chromium draws overlay scrollbars and ignores
`--disable-features=OverlayScrollbar`**, so none of this can be checked in a
screenshot. Read the computed `scrollbar-width`/`scrollbar-color` off the
element and look at the real browser — and note that finding a rule in
`document.styleSheets` proves it parsed, not that it renders. That is the
mistake that let the false explanation above stand for two commits.

## Deployment

Live at **https://cherish-chen9336.github.io/Japanese-romaji/**, published by
`.github/workflows/deploy.yml` on every push to `main` and on
`workflow_dispatch`. First deployed 2026-10-27.

**The workflow is the only CI this repo has**, which is why the gates live in
it: typecheck, then `pnpm test:coverage`, then the build, and a failure in any
of them stops the publish. It is `test:coverage` and not `pnpm test` on
purpose — `pnpm test` is `vitest run` with no `--coverage`, so the thresholds
in `vite.config.ts` never execute under it and the gate would not be a gate.

**`vite.config.ts` sets `base` to `/Japanese-romaji/` for `build` and preview,
and `/` for dev.** Pages serves a project site from a subpath, so a root base
publishes a page whose every asset 404s. Verify a build by running
`pnpm preview`, which serves at the real published path, rather than by
trusting the dev server.

**Two things about Pages that cost an afternoon, recorded so they are not
rediscovered:**

- **`actions/configure-pages` cannot enable Pages here.** Its `enablement`
  input needs a token with admin rights, and the workflow's built-in
  `GITHUB_TOKEN` does not have them. Enabling Pages is a human click at
  **Settings → Pages → Source: "GitHub Actions"**, and until it is made the
  workflow fails at that step having already passed every gate.
- **Pages on a Free account requires a *public* repository.** Private-repo
  Pages is a GitHub Pro/Team/Enterprise feature. This repo was private and was
  made public on 2026-10-27 for that reason. Note what that does and does not
  buy: a Pages site is public on the internet whatever the repo's visibility —
  only Enterprise Cloud can make the *site* private — so paying for Pro would
  have kept the source private and left the site exactly as public as it is
  now. Cloudflare Pages and Vercel publish from a private repo on their free
  tiers and were the alternative; both serve from the domain root, so taking
  one would mean changing `base` to `/`.

**Before the repo went public the history was swept** for committed secrets,
`.env`/key files and real email addresses. It had none — the commits carry
`Cherish-Chen9336@users.noreply.github.com` and `noreply@anthropic.com`. One
local filesystem path and a dead artifact UUID were removed from this file in
`b9d1b8a`. Sweep again before adding any new remote or credential.

## Deliberately not built

Decisions to *not* do something leave no commit and no code, so they live here or
nowhere. Each of these has been proposed at least once and rejected on purpose;
re-proposing one is fine, but start from the reason it lost.

The capability gap audit of 2026-08-21 — measured against `type-review`, the
English typing trainer this project borrowed its three-layer split from — is the
source of several of these. It is a
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
  the 五十音 grid instead, which fits the data closely: 104 of the 119 tracked
  moras sit on the chart and every chart cell is reachable from the corpus. The
  fifteen outside it are eleven sokuon (っか っく っこ っし っしょ って っと っぱ
  っぴょ っぷ っぽ) and four katakana (コ パ ヒ ン), tracked as themselves rather
  than folded into their hiragana cells. `offChartMoras` shows all fifteen
  beside the grid rather than dropping them.
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
- **A kanji dictionary loaded at runtime, to fill in readings for pasted text.**
  Proposed 2026-10-22 and deferred, after measuring kuromoji 0.1.2 on this
  machine: dictionary 17,791,956 bytes over 12 gzipped files, 872 ms to build in
  a browser, JS heap 1 MB → 214 MB, and 19 of 25 right on deliberately hard
  words — 一日中, 一人, 二十歳 and 一月一日 all wrong. The cost buys a *suggestion*
  that still has to be checked, so the review screen survives either way.

  The reframing that settled it: on 寿司打 and e-typing the readings are authored
  in advance, and on Typing Tube and マイタイピング the person who registers a text
  supplies its reading — in both cases a fluent reader doing a one-time job. Only
  this app asked the learner to author their own kanji content, and the
  dictionary was being brought in to paper over that. Authoring the content
  removes the task rather than automating it, and a dictionary used at
  *authoring* time (as `sentenceBank` was) gives the same help with no download,
  no worker and no runtime dependency.

  Yahoo's ルビ振り API is the better runtime option if this ever comes back — no
  download, no resident memory, 300 req/min, 4 KB per request, non-commercial by
  default — but it needs a Yahoo! JAPAN Client ID, and their account support says
  overseas mobile numbers cannot be used for SMS verification. Unverified whether
  that blocks registration from outside Japan; check before building on it.
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
