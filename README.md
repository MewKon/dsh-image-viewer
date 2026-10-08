---
description: "Image viewing for the dsh Web GUI: an expandable card for the model's read_image calls, a browsable index of every workspace image, and a same-origin route a reply can embed."
kind: "package-bundle"
---

# dsh-image-viewer

English | [中文](README.zh.md)

## Summary

A picture viewer for the dsh Web GUI, in two halves. A host half registers two read-only routes on the profile's web server — one streams an image, one indexes the images under your registered workspaces — and a browser half fills three seats: an expandable card for the model's `read_image` calls, a sidebar toggle, and the workspace drawer with its lightbox. The model's image reads stop being a line of text and the pictures already sitting in your workspaces become browsable without leaving the conversation. As a side effect the route lets a reply embed a real local image, which the markdown renderer cannot do with a bare path. Choose it when you work with images on this machine; it serves image files only, out of directories you have already registered as workspaces.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install it as a profile bundle. The package declares both `dsh.bundle` and `dsh.client`, so one command writes the dependency, and the loader reconciles the dependency into `dsh.profile.bundles`, which is what turns this package's own `cordis.patch.yml` into a layer that supplies the `image-viewer` row.

```sh
# From a local checkout — a symlink, so edits and rebuilds flow straight through.
dsh plugin --profile web add link:/abs/path/to/dsh-image-viewer

# Or from this repository.
dsh plugin --profile web add github:MewKon/dsh-image-viewer
```

**Restart `dsh web` once.** Bundle layers are composed at boot, so adding one is the single install step that is not live — before the restart the routes answer `404`. After it, the profile's own `cordis.patch.yml` is live again as usual, and so is a rebuilt client bundle. There is no build step to run: `lib/` is committed, and the package has no `prepare` script.

To remove it:

```sh
dsh plugin --profile web remove dsh-image-viewer
```

### What you get

**An expandable card for `read_image`.** The tool used to leave a single line of text. It now renders a header naming the tool and its state (`运行中` / `已完成` / `失败`), then a thumbnail, file name and full path. Click the thumbnail or **展开** to expand the original in place, click it again to collapse; **查看** opens the untouched file in a new tab. The card previews the file the model actually read, not the normalized copy under the attachment store, so what you see is the file on disk.

**A workspace image drawer.** A 🖼 button beside Settings at the sidebar foot toggles a drawer listing every image under your registered workspaces, grouped by workspace, with a path filter. Click any thumbnail for a full-screen lightbox (Escape, the mask, or the close control dismisses it), offering the original at fit-to-viewport size and a link to open it in a new tab. The header reports the total and flags a truncated scan; the reload control rescans on demand.

**A same-origin route a reply can embed.** The markdown renderer accepts only `http:`/`https:` sources, so `![x](C:\pics\a.png)` parses as the `c:` scheme and renders as a broken-image placeholder. This works instead:

```markdown
![screenshot](/image-viewer/file?p=D%3A%5Cwork%5Ca.png)
```

### Configuration

The row's `config` is set in this package's [`cordis.patch.yml`](cordis.patch.yml). Bundle layers apply before the profile's own patch, so a deployment that wants different values restates only those keys in `${DSH_HOME:-~/.dsh}/profiles/<profile>/cordis.patch.yml`, where the later layer wins.

| Key | Default | Purpose |
|---|---|---|
| `route` | `/image-viewer` | Route prefix. Changing it also means changing `ROUTE` in `src/client.js` and rebuilding: the browser half cannot discover a renamed route before its first request. |
| `extraRoots` | none | Extra allowed roots outside the workspace registry. |
| `maxDepth` | `6` | Deepest directory level `/list` descends to. |
| `maxImages` | `500` | Most images one `/list` response carries. |
| `maxDirs` | `4000` | Most directories one `/list` walk visits. |

### Security model

The two routes carry **no authentication of their own**: anything that can reach the web bind can read the images it can reach, the same reach the dist assets already have. The shipped web profile binds `127.0.0.1`; binding a LAN address would expose these routes too. The boundary itself is deliberately narrow:

- only `GET` and `HEAD` are answered;
- `/file` serves only the image extensions (`png jpg jpeg jfif gif webp bmp avif ico svg`) and answers `403` for anything else, so it is not a general file-download endpoint;
- the target must live inside an allowed root, `..` cannot escape one, and the path is `realpath`ed both before the containment check and before the read, so a symlink or junction cannot point outside;
- a miss is a flat `404`/`403` that never discloses whether a path exists;
- `/list` reports only images, is bounded by the three scan keys above, and skips dependency and version-control trees;
- responses carry `x-content-type-options: nosniff` and a `sandbox` CSP.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The host half is ordinary ESM the Cordis loader imports: `apply` injects `webServer`, takes the allowed roots from `workspaceRegistry` **read optionally** through `ctx.get` (a profile without that service still starts and simply has no roots), and registers one prefix route that dispatches `/file` and `/list`.

The browser half is not a module anything imports. The client module system evaluates `lib/client.js` directly, so the file registers itself with `window.__ModuleLoader__.load({ id, factory })` and the factory returns the Cordis plugin. It is self-contained plain JavaScript — no JSX, no TypeScript, no bundler — and `require` resolves only against the shell's frozen module table, where this bundle asks for exactly one entry: `react`. That is load-bearing rather than incidental: `dsh.client.external` is empty, so any other request would throw in the page.

| File | Role |
|---|---|
| [`src/index.js`](src/index.js) | Host half: root resolution, containment, the image walk, both routes |
| [`src/client.js`](src/client.js) | Browser half: the served bundle, all four components and the stylesheet |
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle patch that supplies the row |
| [`scripts/build.mjs`](scripts/build.mjs) | The build: a copy of `src/` into `lib/` |

A keyed `tool.call.toolview` hit **replaces** the generic tool row for that tool rather than decorating it, which is why the card carries the tool name and state itself. Two of its paths are worth naming: the tool's argument JSON is read off the call head, whose shape differs between a running call (`argsRaw` on the block) and a settled one (`call.argsRaw`), and a path with no recognizable image extension degrades to a plain row instead of a broken thumbnail, because the route authorizes by extension and would answer `403`.

The sidebar toggle and the drawer sit in two unrelated slot trees (`sidebar.footer.action` is root-scoped, `shell.overlay` is root-scoped and frame-wide), so they share their open state through one small store in the bundle's own module scope. The overlay layer is click-through, so the drawer and the lightbox each opt back into pointer events.

**Why HTTP and not a Remote service.** The two halves of one package could talk over a Typert Remote namespace, but a same-origin route is the smaller correct wire here: it serves the image to an `<img>` element as well as to the client half, which a JSON RPC cannot do without base64 in the middle. It also gives markdown embeds the exact URL they need.

**Why `lib/` is tracked.** It is not a build cache. The row points at `lib/index.js` and the browser is served `lib/client.js`, so a clone without it could not be mounted at all. Because the build is a validated copy, `src/` and `lib/` both appear in every source diff.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the viewer is not enough. They move from the seats this package fills to the packages that own them.

- [`@deepseek-ai/dsh-client-modules`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-modules) — how a `dsh.client` declaration becomes a served bundle on the boot graph.
- [`@deepseek-ai/dsh-client-ui-tool`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-tool) — the owner of `tool.call.toolview` and the generic tool row this card replaces for one key.
- [`@deepseek-ai/dsh-client-ui-attachment`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-attachment) — the sibling image experience, and the source of this lightbox's interaction shape.
- [`@deepseek-ai/dsh-base`](https://www.npmjs.com/package/@deepseek-ai/dsh-base) — the `workspaceRegistry` service and the web server these routes register on.

-----

<a id="model-experience"></a>
## Model Experience

None. The host half registers two paths on the web server and no Tool, no prompt section, and no context; the model never learns this plugin exists. The one indirect effect is user-visible only: an `read_image` call the model already makes now renders as a card.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current viewer. They are package constraints, not a general image-viewer comparison or a task backlog.

- **The routes are reachable by anything on the bind.** They add no authentication of their own, so they are exactly as exposed as the web surface they ride on. Widening the bind widens them.
- **An extensionless image is not previewable.** The route authorizes by file extension, because the alternative — sniffing content to decide — is what would turn it into a general file-download endpoint. The card shows the path and says so rather than rendering a broken thumbnail; the conversation's own image rendering still shows an `read_image` result.
- **The card takes over the whole row for that tool.** It replaces the generic row rather than extending it, so `read_image` loses the generic row's argument/result JSON expansion and its duration display. The tool name and state were moved into the card for this reason; the rest was a deliberate trade for an expandable picture.
- **No zoom in the lightbox** — the original renders at fit-to-viewport size only.
- **The drawer is capped, not complete.** Very large trees hit `maxImages` and the header reports it as truncated rather than paging.
- **Adding the bundle needs a restart.** Bundle layers are composed at boot; only the profile's own patch file and a rebuilt client bundle are live.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

```sh
npm run build     # src/ -> lib/
npm test          # 36 assertions, both halves
npm run check     # node --check on both artifacts
```

Build before committing a source change — `lib/` is what actually runs. `npm test` runs the two files directly rather than through `node --test test/`, because that form spawns a child process per file.

`test/host.test.mjs` (17) drives the real `apply` against a stub context and a live HTTP server: index contents, image-only results, `node_modules` skipped, subdirectory scoping, ETag `304`, `HEAD`, a non-image extension refused with `403`, **a real image outside every allowed root refused with `403`**, `..` escapes, mutating methods `405`, and a rootless profile answering `403` without disclosing a path.

`test/client.test.mjs` (19) loads the **built** bundle through a stand-in `__ModuleLoader__` with a stateful React stand-in, and asserts both the contract and the card's behaviour: only `react` requested, the injection declaration, the three seats and their keys, that the card names the tool and its state on **every** path including the degraded ones, that clicking the thumbnail really expands to two `<img>` elements and collapses again, both running and settled call shapes, workspace-relative paths resolved against `cwd`, and a graceful fallback for an extensionless or missing path.

Not covered by either file: layout, CSS, and anything that exists only once React truly mounts a tree. Those need a browser.

The `README.md` / `README.zh.md` pair is maintained as equal-authority translations; `README.i18n.yaml` records the git blob hash of each side as of the last confirmed-consistent state.

</details>

**Runtime invariant:** No companion is published. Both routes are owned by one `ctx.effect` and are removed with the plugin; the browser half owns only effect-registered slot entries, whose lifecycle the slot registry validates.
