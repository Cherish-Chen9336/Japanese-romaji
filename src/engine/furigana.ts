/**
 * Splitting a written word into the parts that need a reading printed above
 * them and the parts that don't.
 *
 * Two things this must NOT do. It must not gloss a word with no kanji in it —
 * こんにちは carries a `reading` of こんにちわ because は is a particle there, and
 * stacking こんにちわ on top of こんにちは would present a spelling difference as
 * a pronunciation gloss. And it must not swallow okurigana: 好きこそ reads
 * すきこそ, but only the 好 needs telling; printing すきこそ across the whole word
 * buries the one character the reader actually needed help with.
 *
 * What it may do, and does: carry a single reading across a run that contains
 * interior kana, when nothing pins those kana down. 物の上手 read もののじょうず
 * has two の and no way to tell which is which, so the whole run takes one
 * annotation — group ruby (熟語ルビ), a real convention, and better than guessing
 * an alignment and captioning the wrong character.
 */

export type RubySegment = {
  text: string
  /** Reading to print above `text`. Absent when the text reads itself. */
  ruby?: string
}

// Unicode property escape rather than hand-written ranges: it covers every CJK
// extension block including the ones beyond the BMP, which a non-`/u` character
// class cannot match at all because they arrive as surrogate pairs. Han covers
// the iteration mark too, which is what furigana wants — 人々 takes a reading
// and the 々 belongs to the word carrying it.
const KANJI = /\p{Script=Han}/u

export function hasKanji(text: string): boolean {
  return KANJI.test(text)
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function commonSuffixLength(a: string, b: string, floor: number): number {
  let i = 0
  while (i < a.length - floor && i < b.length - floor && a[a.length - 1 - i] === b[b.length - 1 - i]) {
    i++
  }
  return i
}

const KANA = /[ぁ-ゖァ-ヺー]/

/**
 * Annotates a stretch of text that has already had its shared ends peeled off.
 *
 * Kana sitting *between* kanji is a free alignment point: 塵も積 read ちりもつ
 * has a も in both, so the reading either side of it can be pinned down and the
 * word split into 塵[ちり] も 積[つ] rather than one block. Only taken when the
 * run appears exactly once in the reading — 物の上手 read もののじょうず has two
 * の and no way to tell which is which, so it stays a group annotation. Group
 * ruby over several characters is a real convention, not a failure mode; the
 * split is just kinder when it's available.
 */
function annotateCore(core: string, reading: string): RubySegment[] {
  // Both recursive calls are guarded to pass a non-empty core and a non-empty
  // reading, and `rubySegments` checks the same before calling in — so the only
  // reason to stop early is a piece with nothing to gloss.
  if (!hasKanji(core)) return [{ text: core }]

  let i = 0
  while (i < core.length) {
    if (!KANA.test(core[i])) {
      i++
      continue
    }
    let end = i
    while (end < core.length && KANA.test(core[end])) end++

    // Interior only — anything at the ends was already peeled.
    if (i > 0 && end < core.length) {
      const run = core.slice(i, end)
      const at = reading.indexOf(run)
      const unambiguous = at > 0 && at === reading.lastIndexOf(run) && at + run.length < reading.length
      if (unambiguous) {
        return [
          ...annotateCore(core.slice(0, i), reading.slice(0, at)),
          { text: run },
          ...annotateCore(core.slice(end), reading.slice(at + run.length)),
        ]
      }
    }
    i = end
  }

  return [{ text: core, ruby: reading }]
}

/**
 * How `display` should be drawn, given how it's read.
 *
 * Peels off the kana that display and reading already share at each end — the
 * okurigana and any leading kana — then annotates what's left, splitting further
 * at any interior kana that pins the reading down unambiguously. 好きこそ /
 * すきこそ becomes 好[す] + きこそ; 学校 / がっこう has nothing to peel, so the
 * whole word takes one reading.
 */
export function rubySegments(display: string, reading?: string): RubySegment[] {
  if (!reading || reading === display || !hasKanji(display)) return [{ text: display }]

  const head = commonPrefixLength(display, reading)
  const tail = commonSuffixLength(display, reading, head)

  const core = display.slice(head, display.length - tail)
  const coreReading = reading.slice(head, reading.length - tail)

  // Nothing distinct left to annotate — the two strings differ only in ways the
  // peeling already removed.
  if (core.length === 0 || coreReading.length === 0) return [{ text: display }]

  return [
    ...(head > 0 ? [{ text: display.slice(0, head) }] : []),
    ...annotateCore(core, coreReading),
    ...(tail > 0 ? [{ text: display.slice(display.length - tail) }] : []),
  ]
}
