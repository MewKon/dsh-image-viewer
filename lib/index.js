/**
 * dsh-image-viewer — the host half.
 *
 * WHAT IT IS
 * Two read-only HTTP routes on the `dsh web` server, so the browser can show
 * pictures that only exist as files on this machine:
 *
 *   GET <route>/file?p=<path>          one image, streamed
 *   GET <route>/list[?p=<dir>][&depth=][&limit=]   a JSON index of images
 *
 * WHY HTTP AND NOT A REMOTE SERVICE
 * The browser cannot display a local path: the frontend markdown renderer only
 * accepts `http:`/`https:` sources, and a Windows path such as `C:\pics\a.png`
 * parses as the `c:` scheme, so `![alt](C:\pics\a.png)` renders as a
 * broken-image placeholder. A same-origin route also gives the client half a
 * plain `fetch` channel back to this process without registering a Typert
 * Remote namespace, which is the smallest correct wire between the two halves
 * of one plugin package.
 *
 * SECURITY MODEL — read before widening the config
 * The route is deliberately narrow, because anything that can reach the
 * loopback bind can reach it (the same reach the dist assets already have; this
 * route adds no authentication of its own):
 *   - only GET and HEAD are answered;
 *   - `/file` serves only the image extensions below; anything else is 403, so
 *     this is not a general file-download endpoint;
 *   - the target must live inside an allowed root: every workspace in the
 *     workspace registry, plus `extraRoots`. `..` never escapes one;
 *   - the path is `realpath`ed before the containment check AND before the
 *     read, so a symlink or junction cannot point outside a root;
 *   - a miss is a flat 404/403 that never discloses whether a path exists;
 *   - `/list` walks directories but only ever reports image files, is bounded by
 *     `maxDepth`/`maxImages`/`maxDirs`, and skips dependency and VCS trees.
 *
 * CONFIG
 *   route:             route prefix; default '/image-viewer'. Keep it in sync
 *                      with ROUTE in src/client.js — the client half has no way
 *                      to discover a renamed route before its first request.
 *   extraRoots:        additional absolute directories to allow (default none).
 *   workspaceRegistry: service name consulted for the allowed workspace roots,
 *                      default 'workspaceRegistry'. Set to '' to disable the
 *                      lookup and rely on `extraRoots` alone.
 *   maxDepth:          deepest directory level `/list` descends to, default 6.
 *   maxImages:         most images one `/list` response carries, default 500.
 *   maxDirs:           most directories one `/list` walk visits, default 4000.
 *
 * @module dsh-image-viewer
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Stable Cordis plugin name. */
const name = 'dsh-image-viewer'

/**
 * Cordis `Inject` accepts ONLY an array of names or a name → intercept-config
 * map — there is no `{ required, optional }` form. `webServer` therefore rides
 * the array, and "the workspace registry is optional" is expressed at runtime
 * by a non-throwing `ctx.get()` lookup below.
 */
const inject = ['webServer']

const DEFAULT_ROUTE = '/image-viewer'
const DEFAULT_WORKSPACE_SERVICE = 'workspaceRegistry'
const DEFAULT_MAX_DEPTH = 6
const DEFAULT_MAX_IMAGES = 500
const DEFAULT_MAX_DIRS = 4000

/** Encoded-media-type table — the whole extension allowlist. */
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

/**
 * Directory names a `/list` walk never enters: dependency trees and version
 * control metadata are enormous, never what a person means by "the pictures in
 * my workspace", and one `node_modules` alone would exhaust the image cap.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  '.git',
  '.hg',
  '.svn',
  '.dsh',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.svelte-kit',
  'coverage',
])

/** One hour of browser caching; the ETag is what actually revalidates. */
const MAX_AGE_SECONDS = 3600

/**
 * Windows device names cannot be opened through the Win32 path API, so
 * absolute paths run through the `\\?\` namespace.
 * @param path - a native absolute path.
 * @returns the same path in extended-length form on Windows.
 */
function extendedLengthPath(path) {
  if (process.platform !== 'win32' || path.startsWith('\\\\?\\')) return path
  return path.startsWith('\\\\') ? `\\\\?\\UNC\\${path.slice(2)}` : `\\\\?\\${path}`
}

/**
 * Compare two paths under this platform's case rules.
 * @param path - a native path.
 * @returns the path in its comparison form.
 */
function pathKey(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * Whether `target` is `root` itself or lives underneath it.
 * @param root - canonical allowed root.
 * @param target - canonical candidate path.
 * @returns true when the candidate is contained.
 */
function isInside(root, target) {
  const rel = relative(pathKey(root), pathKey(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Media type for one path, from the extension allowlist.
 * @param path - a native path.
 * @returns the media type, or undefined when the extension is not served.
 */
function mediaTypeOf(path) {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? undefined : MIME[path.slice(dot).toLowerCase()]
}

/**
 * Parse the raw request URL.
 * @param url - the request URL as node:http reports it.
 * @returns the parsed URL, or undefined when unparsable.
 */
function parseUrl(url) {
  try {
    return new URL(url ?? '/', 'http://localhost')
  } catch {
    return undefined
  }
}

/**
 * Normalize one requested path to a native absolute path.
 * @param raw - the decoded `p` value, absolute or root-relative.
 * @param roots - allowed roots; the first anchors a relative value.
 * @returns the joined absolute path, or undefined when it cannot be formed.
 */
function normalizeRequested(raw, roots) {
  let value = raw.trim()
  if (value === '') return undefined
  value = value.replace(/^\\\\\?\\UNC\\/iu, '\\\\').replace(/^\\\\\?\\/u, '')
  if (value.includes('\0')) return undefined
  /* Position 1 may hold a drive-letter colon (`C:\x`); anywhere after it, a
   * colon is an illegal Win32 path character. Refuse it here instead of
   * letting the platform resolver throw inside the route handler. */
  if (value.slice(2).includes(':')) return undefined
  value = value.replaceAll('/', sep)
  if (isAbsolute(value)) return resolve(value)
  const base = roots[0]
  return base === undefined ? undefined : resolve(join(base, value))
}

/**
 * Answer one request with a status and no body.
 * @param response - the response to write.
 * @param status - the HTTP status code.
 */
function deny(response, status) {
  response.writeHead(status)
  response.end()
}

/**
 * Write a JSON response.
 * @param response - the response to write.
 * @param status - the HTTP status code.
 * @param payload - a JSON-serializable body.
 */
function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/**
 * Collect the canonical allowed roots: every registered workspace plus the
 * configured extra roots.
 * @param ctx - the plugin context.
 * @param workspaceService - service name to consult, or '' to skip.
 * @param extraRoots - configured extra absolute directories.
 * @returns the distinct canonical roots that currently exist.
 */
async function allowedRoots(ctx, workspaceService, extraRoots) {
  const collected = []
  if (workspaceService !== '') {
    /* `ctx.get` never throws and reports nothing for an unprovided service,
     * which is exactly the "optional dependency" behaviour wanted here. */
    const registry = ctx.get(workspaceService)
    let workspaces = []
    try {
      workspaces = registry?.list() ?? []
    } catch (error) {
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    }
    for (const workspace of workspaces) {
      const path = workspace?.path
      if (typeof path !== 'string' || path === '') continue
      try {
        collected.push(await realpath(extendedLengthPath(path)))
      } catch {
        /* an archived or removed workspace directory contributes no root */
      }
    }
  }
  for (const root of extraRoots) {
    try {
      collected.push(await realpath(extendedLengthPath(root)))
    } catch {
      ctx.logger.warn('dsh-image-viewer: configured extra root %o does not exist', root)
    }
  }
  return [...new Set(collected)]
}

/**
 * Walk one root and collect image files, breadth-first so a shallow picture
 * directory is found before the cap is reached.
 * @param root - canonical allowed root to walk.
 * @param limits - depth, image, and directory bounds.
 * @returns the collected files and whether any bound was hit.
 */
async function scanImages(root, limits) {
  const { maxDepth, maxImages, maxDirs } = limits
  const found = []
  const queue = [{ dir: root, depth: 0 }]
  let visited = 0
  let truncated = false
  while (queue.length > 0) {
    if (found.length >= maxImages || visited >= maxDirs) {
      truncated = true
      break
    }
    const { dir, depth } = queue.shift()
    visited += 1
    let entries
    try {
      entries = await readdir(extendedLengthPath(dir), { withFileTypes: true })
    } catch {
      /* an unreadable directory contributes nothing and never fails the walk */
      continue
    }
    for (const entry of entries) {
      if (found.length >= maxImages) {
        truncated = true
        break
      }
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth + 1 > maxDepth) continue
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        queue.push({ dir: child, depth: depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (mediaTypeOf(entry.name) === undefined) continue
      found.push(child)
    }
  }
  return { files: found, truncated, visited }
}

/**
 * Read display metadata for one collected file.
 * @param path - absolute path of the image.
 * @param root - the root it was found under.
 * @param route - the configured route prefix.
 * @returns the JSON row, or undefined when the file vanished mid-walk.
 */
async function describeImage(path, root, route) {
  let info
  try {
    info = await stat(extendedLengthPath(path))
  } catch {
    return undefined
  }
  if (!info.isFile()) return undefined
  return {
    path,
    name: path.slice(path.lastIndexOf(sep) + 1),
    rel: relative(root, path).split(sep).join('/'),
    root,
    size: info.size,
    mtime: info.mtimeMs,
    url: `${route}/file?p=${encodeURIComponent(path)}`,
  }
}

/**
 * Answer `/list`: an index of images under one root or under every allowed
 * workspace.
 * @param url - the parsed request URL.
 * @param response - the response to write.
 * @param ctx - the plugin context.
 * @param config - resolved plugin configuration.
 */
async function serveList(url, response, ctx, config) {
  let roots
  try {
    roots = await allowedRoots(ctx, config.workspaceRegistry, config.extraRoots)
  } catch (error) {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    sendJson(response, 500, { error: 'root lookup failed' })
    return
  }
  if (roots.length === 0) {
    sendJson(response, 403, { error: 'no allowed root is configured' })
    return
  }

  const requested = url.searchParams.get('p')
  let targets = roots
  if (requested !== null && requested.trim() !== '') {
    let normalized
    try {
      normalized = normalizeRequested(requested, roots)
    } catch {
      sendJson(response, 400, { error: 'unusable path' })
      return
    }
    if (normalized === undefined) {
      sendJson(response, 400, { error: 'unusable path' })
      return
    }
    let canonical
    try {
      canonical = await realpath(extendedLengthPath(normalized))
    } catch {
      sendJson(response, 404, { error: 'not found' })
      return
    }
    if (!roots.some((root) => isInside(root, canonical))) {
      sendJson(response, 403, { error: 'outside every allowed root' })
      return
    }
    targets = [canonical]
  }

  const limits = {
    maxDepth: config.maxDepth,
    maxImages: config.maxImages,
    maxDirs: config.maxDirs,
  }
  const images = []
  let truncated = false
  let visited = 0
  for (const root of targets) {
    const remaining = limits.maxImages - images.length
    if (remaining <= 0) {
      truncated = true
      break
    }
    const scan = await scanImages(root, { ...limits, maxImages: remaining })
    truncated = truncated || scan.truncated
    visited += scan.visited
    const described = await Promise.all(scan.files.map((file) => describeImage(file, root, config.route)))
    for (const row of described) if (row !== undefined) images.push(row)
  }

  sendJson(response, 200, {
    route: config.route,
    roots,
    images,
    truncated,
    scannedDirs: visited,
    limits,
  })
}

/**
 * Answer `/file`: resolve, authorize, then stream one image.
 * @param request - the incoming HTTP request.
 * @param response - the response to write.
 * @param url - the parsed request URL.
 * @param ctx - the plugin context.
 * @param config - resolved plugin configuration.
 */
async function serveFile(request, response, url, ctx, config) {
  const raw = url.searchParams.get('p')
  if (raw === null) {
    deny(response, 400)
    return
  }

  let roots
  try {
    roots = await allowedRoots(ctx, config.workspaceRegistry, config.extraRoots)
  } catch (error) {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    deny(response, 500)
    return
  }
  if (roots.length === 0) {
    ctx.logger.warn('dsh-image-viewer: no allowed root is configured; every request is refused')
    deny(response, 403)
    return
  }

  let requested
  try {
    requested = normalizeRequested(raw, roots)
  } catch {
    /* a malformed value (an illegal path character, a bad drive letter) is a
     * client error, never a request that may take the route down */
    deny(response, 400)
    return
  }
  if (requested === undefined) {
    deny(response, 400)
    return
  }
  const mediaType = mediaTypeOf(requested)
  if (mediaType === undefined) {
    deny(response, 403)
    return
  }

  let canonical
  try {
    canonical = await realpath(extendedLengthPath(requested))
  } catch {
    deny(response, 404)
    return
  }
  if (!roots.some((root) => isInside(root, canonical))) {
    deny(response, 403)
    return
  }

  let info
  try {
    info = await stat(extendedLengthPath(canonical))
  } catch {
    deny(response, 404)
    return
  }
  if (!info.isFile()) {
    deny(response, 404)
    return
  }

  const etag = `"${createHash('sha256').update(`${canonical}|${String(info.size)}|${String(info.mtimeMs)}`).digest('hex').slice(0, 32)}"`
  const headers = {
    'cache-control': `private, max-age=${String(MAX_AGE_SECONDS)}`,
    etag,
    'last-modified': new Date(info.mtimeMs).toUTCString(),
    'content-type': mediaType,
    /* SVG is served as a document by browsers that sniff it; the sandbox keeps
     * a workspace SVG from reaching this route's origin privileges. */
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff',
  }
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers)
    response.end()
    return
  }
  response.writeHead(200, { ...headers, 'content-length': String(info.size) })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = createReadStream(extendedLengthPath(canonical))
  stream.on('error', () => response.destroy())
  response.on('close', () => stream.destroy())
  stream.pipe(response)
}

/**
 * Register the `dsh-image-viewer` routes.
 * @param ctx - plugin context carrying `webServer` and, usually,
 *   `workspaceRegistry`.
 * @param rawConfig - validated route, extra roots, and walk bounds.
 */
function apply(ctx, rawConfig) {
  const settings = rawConfig ?? {}
  const route = (settings.route ?? DEFAULT_ROUTE).replace(/\/+$/u, '') || DEFAULT_ROUTE
  const config = {
    route,
    extraRoots: [...(settings.extraRoots ?? [])],
    workspaceRegistry: settings.workspaceRegistry ?? DEFAULT_WORKSPACE_SERVICE,
    maxDepth: Number.isInteger(settings.maxDepth) ? settings.maxDepth : DEFAULT_MAX_DEPTH,
    maxImages: Number.isInteger(settings.maxImages) ? settings.maxImages : DEFAULT_MAX_IMAGES,
    maxDirs: Number.isInteger(settings.maxDirs) ? settings.maxDirs : DEFAULT_MAX_DIRS,
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: route,
        handler: (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            deny(response, 405)
            return
          }
          const url = parseUrl(request.url)
          if (url === undefined) {
            deny(response, 400)
            return
          }
          const pathname = url.pathname.replace(/\/+$/u, '')
          if (pathname === `${route}/file`) {
            return serveFile(request, response, url, ctx, config)
          }
          if (pathname === `${route}/list`) {
            if (request.method === 'HEAD') {
              response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
              response.end()
              return
            }
            return serveList(url, response, ctx, config)
          }
          deny(response, 404)
        },
      }),
    `dsh-image-viewer: ${route} routes`,
  )
}

export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_DIRS,
  DEFAULT_MAX_IMAGES,
  DEFAULT_ROUTE,
  MIME,
  SKIP_DIRS,
  apply,
  inject,
  isInside,
  mediaTypeOf,
  name,
  normalizeRequested,
}
