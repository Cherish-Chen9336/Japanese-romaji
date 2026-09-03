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
- **milestones** — newly reached achievements already appear on the result
  screen, at the moment they are earned.
- **streaks** as its own panel — the current streak is in the overview and the
  longest is one line under the calendar it describes.

The **overview** is learner metrics, not leaderboard metrics: moras seen, weak
moras, recent accuracy, day streak. It previously showed `avg wpm` averaged over
every stored run while `best wpm` was progression-gated — the two disagreeing
about which runs counted — and `current acc` read the *live typing session*,
which on this route is empty, so it reported 100% whatever the history said.

The **keyboard stays, but as a diagnostic and not a mastery surface**, titled
"romaji key errors" under a note saying that one key types many moras and none of
this can say which mora is at fault. It is the widest panel because legibility is
its only problem; being bigger does not make it mean more.

Panels sit in a twelve-column grid **inside each group**, with the groups in
document order, and carry **no chrome at all** — no border, no fill, no radius.
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
carries its own excess in its detail; the legend carries the ranking, which a
grid cannot show — "weakest" and "slowest" side by side. A separate column chart
was tried and removed: it restated in a second surface what the chart's own cells
already hold, and earned none of the width it took.

The progress plots, the key heatmap and the calendar pair off in rows beneath.
Confusions and bigrams — the only surfaces left that cannot name a mora — sit
behind a disclosure.

**The key heatmap follows the kana chart's palette exactly**: a key you have
never missed is the same light teal as a clean mora, and one you miss is the
error colour ramped by how badly. Two states, not a blend — compositing red over
teal reads as muddy brown on screen, because the hues are near enough to
complementary that mixing them lands on grey, so the worst keys looked dirty
rather than wrong.

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
"also tracked" strip is one horizontal row and will not scale past a handful of
sokuon. Chart groups are hardcoded, so a new `KanaGroup` needs adding in two
places. Corpus-wide invariants read `allBankItems()` rather than a hand-listed
set of banks, so a bank added later joins them by existing.

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
