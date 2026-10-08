/**
 * Build `dsh-image-viewer` from `src/` into `lib/`.
 *
 * The two halves are plain JavaScript on purpose — the host half is ordinary
 * ESM the Cordis loader imports, and the client half is already the exact
 * bundle the browser module system expects — so this build is a copy rather
 * than a compilation. It exists as a step so the package keeps the shipped
 * shape (`src/` authored, `lib/` served) and so `npm run check` has a stable
 * artifact to parse-check.
 *
 * `npm run build && npm run check` is the whole toolchain. Nothing here runs
 * the code: `node --check` parses without executing, which matters because the
 * client half cannot execute outside a browser.
 */

import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Authored file → served file. */
const TARGETS = [
  ['src/index.js', 'lib/index.js'],
  ['src/client.js', 'lib/client.js'],
]

for (const [from, to] of TARGETS) {
  const destination = join(root, to)
  await mkdir(dirname(destination), { recursive: true })
  await cp(join(root, from), destination)
  process.stdout.write(`built ${to}\n`)
}

process.stdout.write(`dsh-image-viewer: ${String(TARGETS.length)} file(s) built\n`)
