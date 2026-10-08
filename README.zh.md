---
description: "dsh Web GUI 的图片查看：模型 read_image 调用的可展开卡片、可浏览的工作区图片索引，以及回复可直接嵌入的同源路由。"
kind: "package-bundle"
---

# dsh-image-viewer

[English](README.md) | 中文

## 概述

dsh Web GUI 的图片查看器，由两半构成。Host 半在 profile 的 web server 上注册两条只读路由——一条流出图片，一条索引你已注册工作区里的图片；浏览器半占据三个座位：模型 `read_image` 调用的可展开卡片、侧栏开关，以及带灯箱的工作区抽屉。模型读图不再只落一行文本，工作区里现成的图片也不必离开对话就能浏览。副产品是这条路由让回复可以嵌入真实的本地图片——单纯写路径是做不到的。当你在本机处理图片时选择它；它只提供图片文件，且只在你已注册为工作区的目录内。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

以 profile bundle 的形式安装。本包同时声明了 `dsh.bundle` 与 `dsh.client`，所以一条命令就写入依赖，随后 loader 会把该依赖归入 `dsh.profile.bundles`——正是这一步让本包自带的 `cordis.patch.yml` 成为供给 `image-viewer` 行的层。

```sh
# 从本地检出安装——符号链接，因此改代码并重建会直接生效。
dsh plugin --profile web add link:/abs/path/to/dsh-image-viewer

# 或直接从本仓库安装。
dsh plugin --profile web add github:MewKon/dsh-image-viewer
```

**重启一次 `dsh web`。** bundle 层在启动时合成，所以新增一层是唯一不热生效的安装步骤——重启前路由返回 `404`。重启之后，profile 自己的 `cordis.patch.yml` 照旧热生效，重建的客户端 bundle 也是。不需要跑构建：`lib/` 已入库，本包也没有 `prepare` 脚本。

移除：

```sh
dsh plugin --profile web remove dsh-image-viewer
```

### 你会得到什么

**`read_image` 的可展开卡片。** 该工具原先只落一行文本。现在它渲染一个头部，报出工具名与状态（`运行中` / `已完成` / `失败`），下面是缩略图、文件名与完整路径。点缩略图或**展开**即可就地展开原图，再点收起；**查看**在新标签页打开未经处理的原文件。卡片预览的是模型实际读取的那个文件，而不是附件存储里的归一化副本，所以你看到的就是磁盘上的文件。

**工作区图片抽屉。** 侧栏底部 Settings 旁的 🖼 按钮开合一个抽屉，按工作区分组列出你已注册工作区里的全部图片，并支持按路径过滤。点任意缩略图进入全屏灯箱（Escape、遮罩或关闭控件均可关闭），以适配视口的尺寸给出原图，并提供在新标签打开的链接。头部报告总数，并在扫描被截断时标注；刷新控件按需重扫。

**回复可嵌入的同源路由。** Markdown 渲染器只接受 `http:`/`https:` 源，所以 `![x](C:\pics\a.png)` 会被解析成 `c:` 协议，渲染为裂图占位。下面这样才行：

```markdown
![截图](/image-viewer/file?p=D%3A%5Cwork%5Ca.png)
```

### 配置

行的 `config` 写在本包的 [`cordis.patch.yml`](cordis.patch.yml) 里。bundle 层先于 profile 自己的 patch 应用，所以想改值的部署只需在 `${DSH_HOME:-~/.dsh}/profiles/<profile>/cordis.patch.yml` 中重述那些键，靠后的层获胜。

| 键 | 默认值 | 用途 |
|---|---|---|
| `route` | `/image-viewer` | 路由前缀。改动它同时要改 `src/client.js` 里的 `ROUTE` 并重建：浏览器半在发出第一个请求前无从得知路由被改名。 |
| `extraRoots` | 无 | 工作区注册表之外的额外允许根。 |
| `maxDepth` | `6` | `/list` 下探的最深目录层级。 |
| `maxImages` | `500` | 单次 `/list` 响应携带的图片数上限。 |
| `maxDirs` | `4000` | 单次 `/list` 遍历访问的目录数上限。 |

### 安全模型

两条路由**没有自己的鉴权**：能连上 web 绑定的东西就能读到它能读到的图片，与 dist 静态资源同一个可达面。出厂的 web profile 绑定 `127.0.0.1`；若改成绑定局域网地址，这两条路由也会随之暴露。边界本身是刻意收紧的：

- 只应答 `GET` 与 `HEAD`；
- `/file` 只放行图片扩展名（`png jpg jpeg jfif gif webp bmp avif ico svg`），其余一律 `403`，因此它不是通用文件下载端点；
- 目标必须落在允许根内，`..` 无法逃逸，且路径在包含性判断前后都经过 `realpath`，所以符号链接或 junction 也带不出去；
- 未命中一律返回扁平的 `404`/`403`，从不透露路径是否存在；
- `/list` 只报告图片，受上述三个扫描键约束，并跳过依赖与版本控制目录；
- 响应带 `x-content-type-options: nosniff` 与 `sandbox` CSP。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 半是 Cordis loader 直接导入的普通 ESM：`apply` 注入 `webServer`，通过 `ctx.get` **可选地**读取 `workspaceRegistry` 取得允许根（没有该 service 的 profile 仍能启动，只是没有根），并注册一条前缀路由分发 `/file` 与 `/list`。

浏览器半不是任何东西 import 的模块。client module system 直接求值 `lib/client.js`，因此该文件自行注册：`window.__ModuleLoader__.load({ id, factory })`，由 factory 返回 Cordis plugin。它是自包含的普通 JavaScript——没有 JSX、没有 TypeScript、没有打包器——并且 `require` 只对 shell 冻结的模块表解析，本 bundle 在其中只请求一项：`react`。这是承重设计而非巧合：`dsh.client.external` 为空，多请求任何一个模块都会在页面里抛错。

| 文件 | 职责 |
|---|---|
| [`src/index.js`](src/index.js) | Host 半：根解析、包含性判断、图片遍历、两条路由 |
| [`src/client.js`](src/client.js) | 浏览器半：被送达的 bundle，四个组件与样式表全在其中 |
| [`cordis.patch.yml`](cordis.patch.yml) | 供给该行的 bundle patch |
| [`scripts/build.mjs`](scripts/build.mjs) | 构建：把 `src/` 复制到 `lib/` |

键控的 `tool.call.toolview` 命中是**替换**该工具的通用工具行，而不是装饰它——这正是卡片自己携带工具名与状态的原因。其中两条路径值得点名：工具参数 JSON 从调用头读取，而它的形状在运行中（块上的 `argsRaw`）与已落定（`call.argsRaw`）之间不同；没有可识别图片扩展名的路径会降级为普通行而不是裂图，因为路由按扩展名授权，会返回 `403`。

侧栏开关与抽屉位于两个互不相干的槽位树中（`sidebar.footer.action` 与 `shell.overlay` 都是 root 作用域，后者还覆盖整帧），因此它们通过 bundle 自身模块作用域里一个小 store 共享开合状态。覆盖层是点击穿透的，所以抽屉与灯箱各自重新接管指针事件。

**为什么走 HTTP 而不是 Remote service。** 同一个包的两半本可以用 Typert Remote 命名空间通信，但同源路由在此是更小的正确接线：它既能把图片送给 `<img>` 元素，也能送给客户端半，而 JSON RPC 不夹一层 base64 就做不到；它还顺带给出 markdown 嵌入所需的确切 URL。

**为什么 `lib/` 入库。** 它不是构建缓存。行指向 `lib/index.js`，浏览器被送达 `lib/client.js`，所以缺了它的克隆根本挂不上。由于构建是一次经过校验的复制，`src/` 与 `lib/` 会同时出现在每次源码 diff 中。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当查看器不够用时阅读以下页面。它们从本包填充的座位进入拥有这些座位的包。

- [`@deepseek-ai/dsh-client-modules`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-modules)——`dsh.client` 声明如何变成 boot graph 上被送达的 bundle。
- [`@deepseek-ai/dsh-client-ui-tool`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-tool)——`tool.call.toolview` 的持有方，以及本卡片替换掉的通用工具行。
- [`@deepseek-ai/dsh-client-ui-attachment`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-attachment)——相邻的图片体验，也是本灯箱交互形态的来源。
- [`@deepseek-ai/dsh-base`](https://www.npmjs.com/package/@deepseek-ai/dsh-base)——这些路由注册所依据的 `workspaceRegistry` service 与 web server。

-----

<a id="model-experience"></a>
## 模型体验

无。Host 半只在 web server 上注册两条路径，不注册 Tool、不贡献提示词小节、不注入上下文；模型完全不知道本插件的存在。唯一的间接影响仅对用户可见：模型本就发起的 `read_image` 调用现在渲染为卡片。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前查看器。它们是包约束，不是通用图片查看器对比或任务积压。

- **路由对绑定上的任何东西可达。** 它们不自带鉴权，因此其暴露面与被搭乘的 web 表面完全一致。放宽绑定就等于放宽它们。
- **无扩展名的图片无法预览。** 路由按文件扩展名授权，因为另一条路——嗅探内容来判定——正是会把它变成通用文件下载端点的那件事。卡片会显示路径并说明原因，而不是渲染裂图；`read_image` 的结果仍由对话自身的图片渲染展示。
- **卡片接管了该工具的整行。** 它是替换通用行而非扩展它，所以 `read_image` 失去了通用行的参数/结果 JSON 展开与耗时展示。工具名与状态正因此被移入卡片；其余是为一颗可展开的图片所做的刻意取舍。
- **灯箱无缩放**——原图仅以适配视口的尺寸渲染。
- **抽屉是截断的，不是完整的。** 超大树会触及 `maxImages`，头部将其标注为截断，而不做分页。
- **新增 bundle 需要重启。** bundle 层在启动时合成；只有 profile 自己的 patch 文件与重建的客户端 bundle 是热生效的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

```sh
npm run build     # src/ -> lib/
npm test          # 36 项断言，覆盖两半
npm run check     # 对两个产物执行 node --check
```

提交源码改动前先构建——真正运行的是 `lib/`。`npm test` 直接运行两个文件，而不走 `node --test test/`，因为后者会为每个文件起一个子进程。

`test/host.test.mjs`（17 项）用真的 `apply` 配桩上下文与真实 HTTP server 驱动：索引内容、只返回图片、跳过 `node_modules`、子目录限定、ETag `304`、`HEAD`、非图片扩展名返回 `403`、**根外真实存在的图片返回 `403`**、`..` 逃逸、变更方法 `405`，以及无根的 profile 返回 `403` 且不泄露路径。

`test/client.test.mjs`（19 项）用一个带状态的 React 替身透过 `__ModuleLoader__` 桩加载**构建产物** bundle，既断言契约也断言卡片行为：只请求 `react`、注入声明、三个座位及其键、卡片在**每一条**路径（含降级路径）上都报出工具名与状态、点缩略图真的展开为两个 `<img>` 元素并可收起、运行中与已落定两种调用形状、相对路径按 `cwd` 解析，以及无扩展名或缺失路径时的优雅降级。

两个文件都**没有**覆盖：布局、CSS，以及只有 React 真正挂载树之后才存在的东西。这些要看浏览器。

`README.md` / `README.zh.md` 这一对按同等权威的互译维护；`README.i18n.yaml` 记录上一次确认一致时两侧的 git blob 哈希。

</details>

**运行时不变式：** 不发布伴生入口。两条路由由同一个 `ctx.effect` 持有并随插件移除；浏览器半只持有 effect 注册的 slot entry，其生命周期由槽位注册表校验。
