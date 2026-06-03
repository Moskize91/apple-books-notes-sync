<div align="center">
  <h1>Apple Books Notes Sync</h1>
  <p><a href="./README.md">English</a> | 中文</p>
  <p>
    <a href="https://www.npmjs.com/package/apple-books-notes-sync"><img alt="npm version" src="https://img.shields.io/npm/v/apple-books-notes-sync"></a>
    <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=20.16.0" src="https://img.shields.io/badge/node-%3E%3D20.16.0-brightgreen"></a>
  </p>
</div>

Apple Books Notes Sync 是一个 Obsidian 桌面插件，用于把 Apple Books 的高亮、笔记和 PDF 标注同步为本地 Markdown 笔记。

插件通过 companion CLI `absync` 读取本机 Apple Books 数据，并在 Obsidian UI 进程之外执行同步任务。

## 环境要求

- macOS
- Obsidian 桌面版
- Apple Books 已有本地书库数据
- Node.js `>=20.16.0`
- `sqlite3` 在 `PATH` 中可用
- 可选 PDF 渲染器：`swift`、`mupdf-tools` 的 `mutool`，或 `poppler` 的 `pdftocairo`

插件仅支持桌面端，不支持 Obsidian 移动端。

## 安装

### Obsidian 插件

当插件上架 Obsidian Community Plugins 后，可以这样安装：

1. 打开 **Settings**。
2. 进入 **Community plugins**。
3. 搜索 `Apple Books Notes Sync`。
4. 安装并启用插件。

手动安装时，将 release 文件复制到：

```text
<vault>/.obsidian/plugins/apple-books-notes-sync/
```

插件目录应包含：

- `main.js`
- `manifest.json`
- 如果 release 包含 `styles.css`，也一起复制
- 如果 release 包含 `tools/`，也一起复制

然后重载 Obsidian，并在 **Community plugins** 中启用 Apple Books Notes Sync。

### Companion CLI

在终端安装 CLI companion：

```sh
npm install -g apple-books-notes-sync
```

可用下面命令确认安装：

```sh
absync --help
```

## 首次使用

启用插件后：

1. 打开 Obsidian 中 Apple Books Notes Sync 的插件设置。
2. 在 **absync CLI path** 旁点击 **Detect**。
3. 点击 **Test** 验证 CLI 可用。
4. 从命令面板运行 **Doctor**、**Plan** 或 **Sync**。

默认受管理输出目录是：

```text
<vault>/Apple Books Notes
```

如果还没配置 CLI path 就运行 Sync，插件会显示安装命令和路径检测命令。

## 使用

Apple Books Notes Sync 添加这些 Obsidian 命令：

- `Apple Books Notes Sync: Sync`
- `Apple Books Notes Sync: Plan`
- `Apple Books Notes Sync: Doctor`
- `Apple Books Notes Sync: Create Books.base`

左侧 ribbon 图标会运行 Sync。

`Create Books.base` 会在 `<managedDirName>/Books.base` 创建用于浏览同步书籍笔记的 Obsidian Bases 视图。已有 `.base` 文件默认不会被覆盖，Sync 也不会删除或重写 `.base` 文件。

## 功能

- 将 EPUB 高亮和笔记同步为 Markdown。
- 同步 PDF 标注和渲染后的 PDF 页面图片。
- 将标注较多且有目录结构的 EPUB/PDF 拆分为章节笔记。
- 保留 `sync_paused`、`chapter_notes` 等可交互属性。
- 创建 `Books.base` 视图用于浏览同步后的书籍笔记。
- 将封面图片和 PDF 页面资源保存到受管理目录中。
- 可直接使用 `absync` 做自动化。

## 设置

- **Managed folder [默认: Apple Books Notes]**：当前 vault 中写入生成笔记和资源的目录。
- **Books Base**：创建用于浏览同步书籍笔记的 Obsidian Bases 视图。
- **absync CLI path**：`absync` CLI 的完整路径。使用 **Detect** 自动查找并保存。
- **PDF notes [默认: auto]**：控制是否同步 PDF 标注，以及使用哪个渲染器生成 PDF 页面图片。
- **PDF page opener [默认: Microsoft Edge]**：从生成笔记打开 PDF 页面链接时使用的应用。

## 输出

```text
<vault>/<managedDirName>/
  Books.base
  books/
    <book>.md
    <book>/
      <chapter>.md
  assets/
    covers/
      <asset-id>.png
    pdf/
      <asset-id>/
  .absync/
    state.sqlite
    lock
```

## CLI

CLI 主要用于自动化和排错。常用命令：

```sh
absync doctor
absync plan
absync sync
absync base create
```

完整 CLI 文档见 [docs/CLI.zh-CN.md](docs/CLI.zh-CN.md)。

## FAQ

### 为什么插件需要 CLI？

读取 Apple Books 数据库和渲染 PDF 资源可能耗时较长。插件通过子进程启动 `absync`，避免在 Obsidian UI 进程内执行同步任务，从而保持 Obsidian 响应。

### Sync 会覆盖我的编辑吗？

生成的书籍笔记包含受管理属性和生成正文。`sync_paused`、`chapter_notes` 等可交互属性会被保留。Sync 不会覆盖或删除 `.base` 文件。

### 文件会写到哪里？

默认写到 `<vault>/Apple Books Notes`。可以在插件设置中修改。

### 可以不通过 Obsidian 直接使用 CLI 吗？

CLI 需要一个已安装并启用本插件的目标 Obsidian vault，因为它会读取 vault 级插件设置。

## 贡献者

开发说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。运行完整检查：

```sh
npm run check
```

## 发布

构建 CLI 和插件产物：

```sh
npm run build
```

插件发布 staging 目录是 `plugin-dist/`，其中包含 Obsidian GitHub Release 所需的 `main.js`、`manifest.json`、可选 `styles.css` 和随包工具文件。
