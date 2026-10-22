import { For, Show } from "solid-js";
import { compilePrompt } from "../engine/prompt";
import type { TextItem } from "../engine/types";

/**
 * Japanese with its reading over the kanji, and nothing else.
 *
 * The practice screen draws the same thing with a cursor running through it.
 * This is the still version, for the places that show a text without typing
 * it — and it goes through `compilePrompt` so a list can never disagree with
 * the screen that types what the list offered.
 *
 * It matters most in the library: a learner browsing a list of kanji they
 * cannot read yet is choosing blind, which is the whole reason the readings
 * are authored in the first place.
 */
export function Furigana(props: { items: readonly TextItem[] }) {
  const words = () => compilePrompt([...props.items]).words;
  return (
    <span class="furigana">
      <For each={words()}>
        {(word) => (
          <span class="furigana__word">
            <For each={word.segments}>
              {(segment) => (
                <Show when={segment.ruby} fallback={segment.text}>
                  {(ruby) => (
                    <ruby>
                      {segment.text}
                      <rt>{ruby()}</rt>
                    </ruby>
                  )}
                </Show>
              )}
            </For>
          </span>
        )}
      </For>
    </span>
  );
}
