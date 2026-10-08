---
description: "dsh Web GUI 的图片查看：模型 read_image 调用的可展开卡片，以及可浏览的工作区图片索引。"
kind: "package-bundle"
---

# dsh-image-viewer

[English](README.md) | 中文

## 概述

dsh Web GUI 的图片查看器。模型的 `read_image` 调用渲染为可展开的卡片，已注册工作区里现成的图片也能从侧栏直接浏览。它只提供图片文件，且只在你已注册为工作区的目录内。

## 目录

- [使用本包](#use-this-package)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装

```sh
# 从本地检出安装——符号链接，因此改代码并重建会直接生效。
dsh plugin --profile web add link:/abs/path/to/dsh-image-viewer

# 或从仓库安装。
dsh plugin --profile web add github:MewKon/dsh-image-viewer
```

**重启一次 `dsh web`。** bundle 层在启动时合成，所以新增一层是唯一不热生效的安装步骤——重启前路由返回 `404`。重启之后，profile 自己的 `cordis.patch.yml` 照旧热生效。不需要跑构建，本包也没有 `prepare` 脚本。

移除：`dsh plugin --profile web remove dsh-image-viewer`。

### 你会得到什么

**`read_image` 的可展开卡片。** 头部报出工具名、状态（`运行中` / `已完成` / `失败`）与耗时；下面是缩略图、文件名与完整路径。点缩略图或**展开**即可就地展开原图，再点收起，**查看**在新标签页打开未经处理的原文件，**详情**展开该次调用的原始参数 JSON 与结果文本。卡片预览的是模型实际读取的那个文件，而不是附件存储里的归一化副本。

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

<a id="further-exploration"></a>
## 进一步探索

- [`@deepseek-ai/dsh-client-modules`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-modules)——`dsh.client` 声明如何变成 boot graph 上被送达的 bundle。
- [`@deepseek-ai/dsh-client-ui-tool`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-tool)——本卡片所填充的工具调用视图槽位的持有方。
- [`@deepseek-ai/dsh-client-ui-attachment`](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-attachment)——相邻的图片体验，也是本灯箱交互形态的来源。
- [`@deepseek-ai/dsh-base`](https://www.npmjs.com/package/@deepseek-ai/dsh-base)——这些路由注册所依据的 `workspaceRegistry` service 与 web server。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

**限制**

- **路由对绑定上的任何东西可达。** 它们不自带鉴权，因此其暴露面与被搭乘的 web 表面完全一致。放宽绑定就等于放宽它们。
- **无扩展名的图片无法预览。** 路由按文件扩展名授权，因为嗅探内容来判定正是会把它变成通用文件下载端点的那件事。卡片会显示路径并说明原因，而不是渲染裂图；结果仍由对话自身的图片渲染展示。
- **新增 bundle 需要重启。** bundle 层在启动时合成；只有 profile 自己的 patch 文件与重建的客户端 bundle 是热生效的。

**延期工作**

- [ ] 让抽屉分页，而不是在超过 `maxImages` 时截断大范围扫描。
- [ ] 为灯箱加上缩放与适配宽度，目前它只以适配视口的尺寸渲染原图。
- [ ] 把内容嗅探做成可选项，让无扩展名的图片能在不默认放宽路由的前提下预览。
- [ ] 在运行中的卡片上显示实时耗时，目前它要等已落定的时间戳。
