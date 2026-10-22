import { derivedRomaji, pastedLines, rejectReason } from './lessons'
import type { LibraryReject } from './lessons'
import type { TextItem } from './types'

/**
 * A paste, broken into the pieces a person can confirm before practising it.
 *
 * The library used to refuse any line it could not read on its own and say
 * only that it had — which, for the ordinary case of pasting Japanese with
 * kanji in it, meant the obvious action produced nothing and no way forward.
 * The reading is the one thing no rule can supply, so this asks for that and
 * nothing else: the romaji is derived from what comes back, never typed by
 * hand.
 *
 * Deliberately ignorant of how the segments were arrived at. Splitting where
 * the script changes is all that is possible without a dictionary, but a
 * dictionary can hand the same shape back with better boundaries and the
 * readings already filled in, and nothing downstream has to know the
 * difference.
 */
export type ReviewSegment = {
  /** The text as pasted. What the reader sees, and what ruby is drawn over. */
  text: string
  /** The kana to type for it. Empty while a person still owes us one. */
  reading: string
  /** Whether `text` can spell itself. Kanji cannot; kana can. */
  needsReading: boolean
}

export type TextReview = {
  /** The line this came from, so the screen can show what it is working on. */
  source: string
  segments: readonly ReviewSegment[]
}

/*
 * CJK ideographs, with 々 and 〆 among them: 人々 repeats the character before
 * it, so the mark belongs to the kanji run rather than to the kana after it,
 * and splitting between them would ask for the reading of 人 alone. 〇 joins
 * them for the same reason it is read as a numeral rather than as a circle.
 */
const KANJI = /[々〇㐀-䶿一-鿿豈-﫿]/

/**
 * One segment per run of the same kind of character.
 *
 * Without a dictionary this is the only boundary that can be found honestly:
 * where kanji meets kana, the kana reads itself and the kanji does not. It is
 * not word segmentation and does not pretend to be — 今日はいい天気です comes
 * back as 今日 / はいい / 天気 / です, which is four pieces to confirm rather
 * than the five words a Japanese speaker would name.
 */
export function segmentLine(line: string): ReviewSegment[] {
  const segments: ReviewSegment[] = []
  let run = ''
  let runIsKanji = false

  const flush = () => {
    const text = run.trim()
    run = ''
    // A run that was only spaces leaves nothing to confirm, and an empty
    // segment would join as a double space and break the word counts below.
    if (text === '') return
    segments.push({ text, reading: runIsKanji ? '' : text, needsReading: runIsKanji })
  }

  for (const char of line) {
    const kanji = KANJI.test(char)
    if (run !== '' && kanji !== runIsKanji) flush()
    runIsKanji = kanji
    run += char
  }
  flush()
  return segments
}

/** A paste as a list of lines to confirm, split exactly as the parser splits. */
export function reviewPaste(text: string): TextReview[] {
  return pastedLines(text).map((line) => ({ source: line, segments: segmentLine(line) }))
}

/** The same review with one segment's reading replaced. Nothing is mutated. */
export function withReading(review: TextReview, index: number, reading: string): TextReview {
  return {
    ...review,
    segments: review.segments.map((segment, at) =>
      at === index ? { ...segment, reading } : segment,
    ),
  }
}

/**
 * Whether a kana segment might be hiding a particle.
 *
 * は and へ are written one way and said another, but only where they are
 * grammatical particles — the は in はな is just は. No rule over the
 * characters can tell those apart, so this does not try to: it marks the
 * segments worth a second look and leaves the judgement to the reader.
 */
export function mayHideParticle(segment: ReviewSegment): boolean {
  return !segment.needsReading && /[はへ]/.test(segment.text)
}

/** Whether every segment has a reading to build on. */
export function isReviewReady(review: TextReview): boolean {
  return review.segments.length > 0 && review.segments.every((s) => s.reading.trim() !== '')
}

/**
 * The item a confirmed review becomes, or null while it cannot become one.
 *
 * Segments are joined by spaces, which makes each one its own display word.
 * That is what keeps the three readers of a reading from fighting each other:
 * `rubySegments` is called per word and leaves a kana-only word unannotated,
 * so a は read as わ is shown plainly while 今日 still carries きょう above it.
 *
 * `reading` is omitted where it would only repeat `kana`, because the field
 * means "typed differently from how it is shown" and an identical copy would
 * claim a difference that is not there.
 */
export function reviewItem(review: TextReview): TextItem | null {
  if (!isReviewReady(review)) return null

  const kana = review.segments.map((s) => s.text).join(' ')
  const reading = review.segments.map((s) => s.reading.trim()).join(' ')
  const romaji = derivedRomaji(reading)
  // Checked against the same four rules a paste is parsed against, because a
  // rule enforced on one path is a rule the other can break. Someone typing a
  // space into a reading box is all it takes to break the word counts.
  if (rejectReason(kana, romaji, reading) !== null) return null

  return reading === kana
    ? { kana, romaji: romaji as string }
    : { kana, reading, romaji: romaji as string }
}

/**
 * Why a confirmed review still cannot be practised, or null when it can.
 *
 * `no-reading` while a box is empty, which is the ordinary waiting state and
 * not an error — the screen shows the box, not the reason.
 */
export function reviewReject(review: TextReview): LibraryReject['reason'] | null {
  const kana = review.segments.map((s) => s.text).join(' ')
  const reading = review.segments.map((s) => s.reading.trim()).join(' ')
  if (!isReviewReady(review)) return 'no-reading'
  return rejectReason(kana, derivedRomaji(reading), reading)
}

/** The romaji a review would be practised as, for showing it before it is. */
export function reviewRomaji(review: TextReview): string | null {
  return reviewItem(review)?.romaji ?? null
}
