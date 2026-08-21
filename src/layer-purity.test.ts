import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Enforces the engine/io/ui layering: engine must not import from io or ui,
 * and io must not import from ui. Without this, "pure engine" is just a
 * convention someone can accidentally break in a later edit — this makes it
 * a build failure instead. Mirrors the equivalent check in type-review.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url))

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(full)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [full]
  })
}

function importSpecifiers(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8')
  const specifiers: string[] = []
  const staticImport = /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicImport = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  const requireCall = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const re of [staticImport, dynamicImport, requireCall]) {
    for (const match of content.matchAll(re)) {
      specifiers.push(match[1])
    }
  }
  return specifiers
}

function violatesLayer(specifier: string, forbidden: string[]): boolean {
  if (specifier.startsWith('@/')) {
    return forbidden.some((layer) => specifier.startsWith(`@/${layer}/`) || specifier === `@/${layer}`)
  }
  if (!specifier.startsWith('.')) return false
  return forbidden.some((layer) => specifier.includes(`/${layer}/`) || specifier.endsWith(`/${layer}`))
}

describe('layer purity', () => {
  it('engine/ never imports from io/ or ui/', () => {
    const files = collectSourceFiles(join(SRC_DIR, 'engine'))
    const violations = files.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => violatesLayer(spec, ['io', 'ui']))
        .map((spec) => `${file} -> ${spec}`),
    )
    expect(violations).toEqual([])
  })

  it('io/ never imports from ui/', () => {
    const files = collectSourceFiles(join(SRC_DIR, 'io'))
    const violations = files.flatMap((file) =>
      importSpecifiers(file)
        .filter((spec) => violatesLayer(spec, ['ui']))
        .map((spec) => `${file} -> ${spec}`),
    )
    expect(violations).toEqual([])
  })
})
