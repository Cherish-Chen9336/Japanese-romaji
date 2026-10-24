import type { JSX } from 'solid-js'

/**
 * Four book spines on a shelf, set beside the library page's heading.
 *
 * It is Lucide's `library` (ISC), taken from the icon source rather than
 * redrawn, and it is deliberately the same family and the same stroke weight as
 * the keyboard in `Topbar` — one outline family across the app, or the two
 * marks read as two different pieces of software.
 *
 * Sized in `em` so it tracks the heading it sits next to: `--fs-24` is a
 * `clamp()`, so a pixel size would be right at exactly one window width.
 */
export function LibraryMark(): JSX.Element {
  return (
    <svg
      class="library__mark"
      viewBox="0 0 24 24"
      width="0.9em"
      height="0.9em"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m16 6 4 14" />
      <path d="M12 6v14" />
      <path d="M8 8v12" />
      <path d="M4 4v16" />
    </svg>
  )
}
