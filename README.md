# dsh-image-viewer

A picture viewer for the [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI. It does two things:

1. **Expanding the image the model read.** `read_image` used to leave a single line of text in the conversation. It now renders as a card — a header naming the tool and its state (`运行中` / `已完成` / `失败`), then a thumbnail, file name and path. Click it to expand the full picture in place, click again to collapse; **查看** opens the untouched original in a new tab.
2. **Browsing the pictures already in your workspaces.** A 🖼 button beside Settings at the sidebar foot opens a drawer: every image under your registered workspaces, grouped by workspace, with a path filter and a full-screen lightbox.

One side effect worth knowing: the host half registers `/image-viewer/file`, a same-origin image route, so a reply can embed a real local picture:

```markdown
![screenshot](/image-viewer/file?p=D%3A%5Cwork%5Ca.png)
```

That works because the frontend markdown renderer accepts only `http:`/`https:` sources — a bare Windows path parses as the `c:` scheme and renders as a broken-image placeholder.

## Install

The package has two halves and needs no build toolchain, no registry install, and no `node_modules` entry. Put the project wherever you like and point a profile at it.

**1. Add one row to your profile's patch layer** — `${DSH_HOME:-~/.dsh}/profiles/<profile>/cordis.patch.yml`, whose default content is just `[]`:

```yaml
- insert:
    - id: image-viewer
      name: 'file:///<absolute-path-to>/dsh-image-viewer/lib/index.js'
      config:
        route: /image-viewer
        maxDepth: 6
        maxImages: 500
        maxDirs: 4000
```

The row is named by an absolute **file URL** rather than a package name. The loader resolves a path-like row to the nearest `package.json`, which is how this package's `dsh.client` declaration reaches the browser roster — so the project can live anywhere, and there is nothing to install.

**2. Refresh the page.** The host row (and the patch) reload live; the client bundle is served from `lib/client.js` and reaches the browser on the next page load. No `dsh web` restart.

If you pick a different `route`, change `ROUTE` in `src/client.js` to match and rebuild: the client half has no way to discover a renamed route before its first request.

## Layout

| Path | Role |
| --- | --- |
| `src/index.js` → `lib/index.js` | Host half: plain ESM, imported by the Cordis loader |
| `src/client.js` → `lib/client.js` | Client half: the bundle the browser evaluates |
| `scripts/build.mjs` | The build: a validated copy of `src/` into `lib/` |
| `test/` | Node tests for both halves |

`lib/` is **tracked on purpose**. It is not a build cache here — the profile points at `lib/index.js` and the browser is served `lib/client.js`, so a clone without it could not be mounted at all. Because the build is a copy, both directories appear in every source diff.

## How the two halves work

**Host half** (`src/index.js`) mounts two read-only routes on the profile's web server:

```
GET /image-viewer/file?p=<absolute path>          stream one image
GET /image-viewer/list[?p=<dir>][&limit=]         JSON index of images
```

Its allowed roots are the paths in `workspaceRegistry` plus any configured `extraRoots`.

**Client half** (`src/client.js`) is not a module anything imports. The client module system evaluates it directly, so the file registers itself:

```js
window.__ModuleLoader__.load({ id: 'dsh-image-viewer', factory: (require) => { /* … */ } })
```

No JSX, no TypeScript, no bundler. `require` resolves only against the shell's frozen module table, and this bundle asks for exactly one entry — `react`. That is load-bearing: `dsh.client.external` is empty, so any other request would throw in the page. A test asserts the request list is `['react']`.

It claims three seats:

| Slot | Purpose |
| --- | --- |
| `tool.call.toolview`, key `read_image` | The expandable image card |
| `sidebar.footer.action` | The 🖼 toggle beside Settings |
| `shell.overlay` | The workspace drawer and its lightbox |

A keyed `tool.call.toolview` hit **replaces** the generic tool row for that tool rather than decorating it, which is why the card carries the tool name and state itself. The sidebar toggle and the drawer sit in two unrelated slot trees and share their open state through one tiny store in the bundle's module scope.

## Development

```sh
npm run build     # src/ -> lib/
npm test          # 36 assertions: host routes and security boundary + client contract
npm run check     # node --check on both artifacts
```

Build before committing a source change — `lib/` is what actually runs.

**Which half reloads how:**

- **Host half and patch config** — live. Rebuild and the routes are the new ones.
- **Client half** — `npm run build` changes the artifact, client-hmr re-hashes it into a new boot-graph revision, and the next page load picks it up.

`npm test` runs `node test/host.test.mjs && node test/client.test.mjs` rather than `node --test test/`, because the latter spawns a child process per file.

## What the tests actually cover

`test/host.test.mjs` (17) drives the real `apply` against a stub context and a live HTTP server: index contents, image-only results, `node_modules` skipped, subdirectory scoping, ETag `304`, `HEAD`, a non-image extension refused with `403`, **a real image outside every allowed root refused with `403`**, `..` escapes, mutating methods `405`, and a no-roots profile answering `403` without disclosing a path.

`test/client.test.mjs` (19) loads the **built** bundle through a stand-in `__ModuleLoader__` with a stateful React stand-in, and asserts the contract and the card's behaviour: only `react` requested, the `inject` declaration, the three seats and their keys, that the card names the tool and its state on **every** path including the degraded ones, that clicking the thumbnail really expands to two `<img>` elements and collapses again, both running and settled `block` shapes, workspace-relative paths resolved against `cwd`, and a graceful fallback instead of a broken thumbnail for an extensionless or missing path.

Not covered: layout, CSS, and anything that exists only once React truly mounts a tree. Those need a browser.

## Security model

The two routes carry **no authentication of their own**: anything that can reach the web bind can read the images it can reach, the same reach the dist assets already have. The shipped web profile binds `127.0.0.1`; binding a LAN address would expose these routes too. The boundary itself is deliberately narrow:

- only `GET` and `HEAD` are answered;
- `/file` serves only the image extensions (`png jpg jpeg jfif gif webp bmp avif ico svg`) and answers `403` for anything else, so it is not a general file-download endpoint. **This is also why an image with no extension shows its path instead of a preview** in the card;
- the target must live inside an allowed root, `..` cannot escape one, and the path is `realpath`ed both before the containment check and before the read, so a symlink or junction cannot point outside;
- a miss is a flat `404`/`403` that never discloses whether a path exists;
- `/list` reports only images, is bounded by `maxDepth`/`maxImages`/`maxDirs`, and skips dependency and version-control trees;
- responses carry `x-content-type-options: nosniff` and a `sandbox` CSP.

Widen it through the row's `config`:

```yaml
config:
  route: /image-viewer
  extraRoots: ['D:\pics']   # extra allowed roots outside the workspace registry
  maxDepth: 6
  maxImages: 500
  maxDirs: 4000
```

## Disable or remove

- **Turn it off** — replace the `- insert:` block in `cordis.patch.yml` with a bare `[]` on its own line. Live.
- **Remove it** — delete the project directory and clear the patch the same way.

## License

MIT — see [LICENSE](LICENSE).
