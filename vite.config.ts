/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig(({ command, isPreview }) => ({
  /*
   * GitHub Pages serves a project site from `/<repo>/`, so every built asset
   * URL needs that prefix or the page loads and fetches nothing. Only on
   * `build`: the dev server has the whole origin to itself, and a base there
   * would move localhost:5173 under a subpath for no reason. The app routes on
   * the hash, so no 404 rewrite is needed on top of this. Drop this line if the
   * site ever moves to a domain root.
   *
   * `isPreview` is in the test because `vite preview` reports `command` as
   * 'serve'. Without it, preview served `dist` at the origin root while the
   * HTML inside it asked for `/Japanese-romaji/assets/...` — every asset a
   * 404, which is the one failure preview exists to catch.
   */
  base: command === 'build' || isPreview ? '/Japanese-romaji/' : '/',
  plugins: [solid()],
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}'],
      thresholds: {
        'src/engine/**': { statements: 100, lines: 100, functions: 100 },
        'src/io/**': { statements: 80, lines: 80 },
      },
    },
  },
}))
