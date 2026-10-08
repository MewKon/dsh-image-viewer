---
description: "Image viewing for the dsh Web GUI: an expandable card for the model's read_image calls, and a browsable index of every workspace image."
kind: "package-bundle"
---

# dsh-image-viewer

English | [中文](README.zh.md)

## Summary

A picture viewer for the dsh Web GUI. The model's `read_image` calls render as an expandable card, and every picture already sitting in your registered workspaces becomes browsable from the sidebar. It serves image files only, out of directories you have already registered as workspaces.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### Install

```sh
# From a local checkout — a symlink, so edits and rebuilds flow straight through.
dsh plugin --profile web add link:/abs/path/to/dsh-image-viewer

# Or from the repository.
dsh plugin --profile web add github:MewKon/dsh-image-viewer
```

**Restart `dsh web` once.** Bundle layers are composed at boot, so adding one is the only install step that is not live — before the restart the routes answer `404`. After it, the profile's own `cordis.patch.yml` is live again as usual. There is no build step to run and no `prepare` script.

To remove it: `dsh plugin --profile web remove dsh-image-viewer`.

### What you get

**An expandable card for `read_image`.** A header naming the tool, its state (`运行中` / `已完成` / `失败`) and how long it took; then a thumbnail, file name and full path. Click the thumbnail or **展开** to expand the original in place, click again to collapse, and **查看** opens the untouched file in a new tab. **详情** expands the call's raw argument JSON and its result text. The card previews the file the model actually read, not the normalized copy under the attachment store.

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

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-client-modules`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-modules) — how a `dsh.client` declaration becomes a served bundle on the boot graph.
- [`@deepseek-ai/dsh-client-ui-tool`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-tool) — the owner of the tool-call view slot this card fills.
- [`@deepseek-ai/dsh-client-ui-attachment`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-attachment) — the sibling image experience, and the source of this lightbox's interaction shape.
- [`@deepseek-ai/dsh-base`](https://www.npmjs.com/package/@deepseek-ai/dsh-base) — the `workspaceRegistry` service and the web server these routes register on.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

**Limitations**

- **The routes are reachable by anything on the bind.** They add no authentication of their own, so they are exactly as exposed as the web surface they ride on. Widening the bind widens them.
- **An extensionless image is not previewable.** The route authorizes by file extension, because sniffing content to decide is what would turn it into a general file-download endpoint. The card shows the path and says so rather than rendering a broken thumbnail; the conversation's own image rendering still shows the result.
- **Adding the bundle needs a restart.** Bundle layers are composed at boot; only the profile's own patch file and a rebuilt client bundle are live.

**Deferred work**

- [ ] Page the drawer instead of truncating a large scan at `maxImages`.
- [ ] Add zoom and fit-to-width to the lightbox, which currently renders the original at fit-to-viewport size only.
- [ ] Make content sniffing an opt-in so an extensionless image can preview without widening the route by default.
- [ ] Show a live elapsed figure on a running card, which today waits for the settled timestamps.
