<div align="center">
  <h1>apple-books-notes-sync</h1>
  <p><a href="./README.md">English</a> | 中文</p>
  <p>
    <a href="https://www.npmjs.com/package/apple-books-notes-sync"><img alt="npm version" src="https://img.shields.io/npm/v/apple-books-notes-sync"></a>
    <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=20.16.0" src="https://img.shields.io/badge/node-%3E%3D20.16.0-brightgreen"></a>
  </p>
</div>

将 Apple Books 的高亮和笔记同步为 Obsidian vault 中的 Markdown 文件。

本项目包含两部分：

- Obsidian 桌面插件：负责 vault 级设置和应用内命令。
- `absync` CLI companion：用于对已安装并启用插件的 vault 做自动化同步。

## 环境要求

- macOS
- Obsidian 桌面版
- 使用 CLI 时需要 Node.js `>=20.16.0`
- Apple Books 已有本地书库数据
- `sqlite3` 在 `PATH` 中可用
- 可选 PDF 渲染器：`swift`、`mupdf-tools` 的 `mutool`，或 `poppler` 的 `pdftocairo`

插件仅支持桌面端，不支持 Obsidian 移动端。

## CLI 安装

```sh
npm install -g apple-books-notes-sync
absync --help
```

也可以不全局安装：

```sh
npx apple-books-notes-sync --help
```

CLI 不再保存全局配置。它会发现 Obsidian vault，并读取目标 vault 内 Apple Books Notes Sync 插件的设置。

## 首次使用

先在目标 vault 中安装并启用 Obsidian 插件，然后在 Obsidian 插件设置页配置。默认受管理输出目录是：

```text
<vault>/Apple Books Notes
```

写入前建议先检查环境并预览计划：

```sh
absync vaults
absync doctor
absync books
absync plan
absync sync
```

如果存在多个 vault，可以指定 vault：

```sh
absync sync --vault "MyVault"
absync sync --vault c957b104655c94aa
absync sync --vault "/path/to/MyVault"
```

selector 解析顺序是：Obsidian vault ID、vault 名称、绝对路径。vault 名称重复时会报错，要求改用 ID 或路径。

## 命令

### `absync vaults`

列出从 Obsidian 全局数据中发现的 vault。

```sh
absync vaults
absync vaults --json
```

### `absync doctor`

检查本地环境和目标 vault 是否可以同步。

```sh
absync doctor
absync doctor --vault "MyVault"
```

### `absync books`

列出可同步的 Apple Books 条目。

```sh
absync books
absync books --json
```

该命令只读取 Apple Books 本地数据，不需要目标 vault。可同步格式为 EPUB 和 PDF。

### `absync plan`

预览 `sync` 将执行的写入和删除，不修改文件。

```sh
absync plan
absync plan --vault "MyVault"
absync plan --book "Newton"
absync plan --json
```

### `absync sync`

写入变更后的 Markdown 文件和受管理 PDF 资源。

```sh
absync sync
absync sync --vault "MyVault"
absync sync --dry-run
absync sync --book "Newton"
```

输出目录结构：

```text
<vault>/<managedDirName>/
  index.md
  books/
    <book>.md
  assets/
    covers/
      <asset-id>.png
    pdf/
      <asset-id>/
  .absync/
    state.sqlite
    lock
```

## 开发

构建 CLI 和插件产物：

```sh
npm run build
```

本地插件调试时，复制 `.env.template` 为 `.env.local`，填写 `OBSIDIAN_DEV_VAULT`，然后运行：

```sh
npm run dev:plugin:install
```

插件发布 staging 目录是 `plugin-dist/`，其中包含 Obsidian GitHub Release 所需的 `main.js`、`manifest.json` 和可选 `styles.css`。
