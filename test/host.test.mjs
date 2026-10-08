/**
 * Host-half tests: route shape, the image index, and the security boundary.
 *
 * These run the real `apply` against a stub context, so what they exercise is
 * the shipped code path — the same handler `dsh web` will call — rather than a
 * reimplementation of it. Run with `npm test` (node --test).
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply, isInside, mediaTypeOf, normalizeRequested } from '../src/index.js'

/** A valid 1x1 PNG, so the bytes really are an image rather than a text stub. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

/**
 * Build a stub Cordis context that captures the registered route.
 * @param roots - workspace paths the stub registry reports.
 * @returns the stub context plus the captured route list.
 */
function makeCtx(roots) {
  const routes = []
  const warnings = []
  return {
    routes,
    warnings,
    logger: {
      warn: (...args) => warnings.push(args),
      info: () => {},
    },
    get: (service) => (service === 'workspaceRegistry' ? { list: () => roots.map((path) => ({ id: path, path })) } : undefined),
    effect: (callback) => callback(),
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
}

/**
 * Start an HTTP server that dispatches to the plugin's prefix route.
 * @param ctx - the stub context whose route should serve requests.
 * @param port - port to bind; 0 picks a free one.
 * @returns the base URL and a close function.
 */
async function serve(ctx, port = 0) {
  const server = createServer((request, response) => {
    const route = ctx.routes[0]
    if (route === undefined) {
      response.writeHead(500)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  return {
    base: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

describe('normalizeRequested', () => {
  it('anchors a relative path at the first allowed root', () => {
    const roots = process.platform === 'win32' ? ['D:\\work'] : ['/work']
    const result = normalizeRequested('docs/a.png', roots)
    assert.equal(result, join(roots[0], 'docs', 'a.png'))
  })

  it('refuses an empty value and a NUL byte', () => {
    assert.equal(normalizeRequested('   ', ['/work']), undefined)
    assert.equal(normalizeRequested('a\0b.png', ['/work']), undefined)
  })
})

describe('mediaTypeOf', () => {
  it('accepts the image allowlist and rejects everything else', () => {
    assert.equal(mediaTypeOf('a.PNG'), 'image/png')
    assert.equal(mediaTypeOf('a.Jpeg'), 'image/jpeg')
    assert.equal(mediaTypeOf('a.svg'), 'image/svg+xml')
    assert.equal(mediaTypeOf('a.txt'), undefined)
    assert.equal(mediaTypeOf('noext'), undefined)
  })
})

describe('isInside', () => {
  it('accepts the root itself and its descendants, rejecting siblings', () => {
    const root = process.platform === 'win32' ? 'D:\\work' : '/work'
    assert.equal(isInside(root, root), true)
    assert.equal(isInside(root, join(root, 'a', 'b')), true)
    assert.equal(isInside(root, process.platform === 'win32' ? 'D:\\other' : '/other'), false)
  })
})

describe('host routes', () => {
  /** @type {string} */ let rootDir
  /** @type {string} */ let outsideDir
  /** @type {string} */ let base
  /** @type {() => Promise<void>} */ let close
  /** @type {ReturnType<typeof makeCtx>} */ let ctx

  before(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'diw-root-'))
    outsideDir = await mkdtemp(join(tmpdir(), 'diw-outside-'))
    await mkdir(join(rootDir, 'nested', 'deep'), { recursive: true })
    await mkdir(join(rootDir, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(rootDir, 'top.png'), PNG)
    await writeFile(join(rootDir, 'nested', 'deep', 'inner.png'), PNG)
    await writeFile(join(rootDir, 'notes.txt'), 'not an image')
    await writeFile(join(rootDir, 'node_modules', 'pkg', 'dep.png'), PNG)
    await writeFile(join(outsideDir, 'secret.png'), PNG)

    ctx = makeCtx([rootDir])
    apply(ctx, { maxDepth: 6 })
    const server = await serve(ctx)
    base = server.base
    close = server.close
  })

  after(async () => {
    if (close !== undefined) await close()
  })

  it('registers exactly one prefix route', () => {
    assert.equal(ctx.routes.length, 1)
    assert.equal(ctx.routes[0].kind, 'prefix')
    assert.equal(ctx.routes[0].path, '/image-viewer')
  })

  it('lists images, skips non-images and dependency trees', async () => {
    const response = await fetch(`${base}/image-viewer/list`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    const rels = payload.images.map((image) => image.rel).sort()
    assert.deepEqual(rels, ['nested/deep/inner.png', 'top.png'])
    assert.equal(payload.truncated, false)
    assert.equal(payload.images[0].url.startsWith('/image-viewer/file?p='), true)
    assert.equal(payload.images[0].size, PNG.byteLength)
  })

  it('restricts a scan to an explicit subdirectory', async () => {
    const response = await fetch(`${base}/image-viewer/list?p=${encodeURIComponent('nested')}`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload.images.map((image) => image.rel), ['deep/inner.png'])
  })

  it('serves image bytes with the right media type and an ETag', async () => {
    const response = await fetch(`${base}/image-viewer/file?p=${encodeURIComponent(join(rootDir, 'top.png'))}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.notEqual(response.headers.get('etag'), null)
    const body = Buffer.from(await response.arrayBuffer())
    assert.equal(body.byteLength, PNG.byteLength)
    assert.equal(body.subarray(0, 4).toString('hex'), '89504e47')
  })

  it('revalidates with an ETag instead of resending bytes', async () => {
    const first = await fetch(`${base}/image-viewer/file?p=${encodeURIComponent(join(rootDir, 'top.png'))}`)
    const etag = first.headers.get('etag')
    const second = await fetch(`${base}/image-viewer/file?p=${encodeURIComponent(join(rootDir, 'top.png'))}`, {
      headers: { 'if-none-match': etag },
    })
    assert.equal(second.status, 304)
  })

  it('answers HEAD without a body', async () => {
    const response = await fetch(`${base}/image-viewer/file?p=${encodeURIComponent(join(rootDir, 'top.png'))}`, {
      method: 'HEAD',
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '')
  })

  it('refuses a non-image extension', async () => {
    const response = await fetch(`${base}/image-viewer/file?p=${encodeURIComponent(join(rootDir, 'notes.txt'))}`)
    assert.equal(response.status, 403)
  })

  it('refuses a real image that lives outside every allowed root', async () => {
    const response = await fetch(`${base}/image-viewer/file?p=${encodeURIComponent(join(outsideDir, 'secret.png'))}`)
    assert.equal(response.status, 403)
  })

  it('refuses a traversal that climbs out of the root', async () => {
    const escaping = join(rootDir, '..', 'diw-outside-nope', 'x.png')
    const response = await fetch(`${base}/image-viewer/file?p=${encodeURIComponent(escaping)}`)
    assert.equal(response.status === 200, false)
  })

  it('refuses the same escape through /list', async () => {
    const response = await fetch(`${base}/image-viewer/list?p=${encodeURIComponent(join(outsideDir))}`)
    assert.equal(response.status, 403)
  })

  it('refuses a mutating method', async () => {
    const response = await fetch(`${base}/image-viewer/file?p=x.png`, { method: 'POST' })
    assert.equal(response.status, 405)
  })

  it('404s an unknown sub-path and a missing parameter', async () => {
    assert.equal((await fetch(`${base}/image-viewer/nope`)).status, 404)
    assert.equal((await fetch(`${base}/image-viewer/file`)).status, 400)
  })

  it('reports no allowed root rather than leaking a path', async () => {
    const empty = makeCtx([])
    apply(empty, {})
    const server = await serve(empty)
    try {
      assert.equal((await fetch(`${server.base}/image-viewer/list`)).status, 403)
      assert.equal((await fetch(`${server.base}/image-viewer/file?p=a.png`)).status, 403)
    } finally {
      await server.close()
    }
  })
})
