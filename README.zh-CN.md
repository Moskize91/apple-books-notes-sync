<div align="center">
  <h1>apple-books-notes-sync</h1>
  <p>中文 | <a href="./README.md">English</a></p>
  <p>
    <a href="https://www.npmjs.com/package/apple-books-notes-sync"><img alt="npm version" src="https://img.shields.io/npm/v/apple-books-notes-sync"></a>
    <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=20.16.0" src="https://img.shields.io/badge/node-%3E%3D20.16.0-brightgreen"></a>
  </p>
</div>

将 Apple Books 的划线和笔记同步为本地 Markdown 文件，适合写入 Obsidian vault。

`apple-books-notes-sync` 安装后提供 `absync` 命令。它读取当前 macOS 用户的本地 Apple Books 数据库，先判断哪些书需要更新，再把受管理的 Markdown 输出写入 Obsidian vault。

## 安装

```sh
npm install -g apple-books-notes-sync
absync --help
```

也可以不全局安装，直接运行：

```sh
npx apple-books-notes-sync --help
```

要求：

- macOS
- Node.js `>=20.16.0`
- 当前用户有本地 Apple Books 资料库数据
- 如果要同步笔记，需要一个已经存在的 Obsidian vault
- `PATH` 中可用的 `sqlite3`
- 可选 PDF 渲染器：来自 `mupdf-tools` 的 `mutool`，或来自 `poppler` 的 `pdftocairo`

## 首次使用

先设置 Obsidian vault 根目录。这里必须是 vault 文件夹本身，不是用于存放 Apple Books 笔记的子文件夹。

```sh
absync config set output.dir "/path/to/ObsidianVault"
```

然后检查环境、查看书籍、预览变更，再执行同步：

```sh
absync doctor
absync books
absync plan
absync sync
```

默认受管理输出目录是：

```text
<output.dir>/Apple Books Notes
```

可以修改受管理文件夹名称：

```sh
absync config set output.managedDirName "Apple Books Notes"
```

## 如何探索命令

`absync` 把操作细节放在命令自己的帮助里。根帮助给出整体流程，每个命令再解释自己的选项、规则和示例。

从根文档开始：

```sh
absync --help
```

需要展开时，查看具体命令的 `--help`：

```sh
absync config --help
absync config set --help
absync plan --help
absync sync --help
absync books --help
absync doctor --help
```

`help` 子命令被有意禁用。使用 `--help`：

```sh
absync --help
absync sync --help
```

不确定时：

- 从 `absync --help` 开始。
- 使用可能写入文件的命令前，先阅读该命令自己的 `--help`。
- 执行 `absync sync` 前，先运行 `absync plan`。
- 需要稳定结构化输出时，使用 `books --json` 和 `plan --json`。
- 不要随意覆盖 `HOME`；Apple Books 数据查找依赖当前用户的 macOS 容器目录。
- 配置 key 和可接受值以 `absync config --help` 或 `absync config set --help` 为准。

## 命令

### `absync config`

管理配置文件：

```text
~/Library/Application Support/apple-books-notes-sync/config.json
```

常用操作：

```sh
absync config
absync config path
absync config list
absync config get output.dir
absync config set output.dir "/path/to/ObsidianVault"
absync config unset output.dir
absync config edit
```

配置 key：

- `output.dir`
  - `plan` 和 `sync` 必填
  - 必须是已经存在的 Obsidian vault 根目录
  - 必须包含 `.obsidian/`
- `output.managedDirName`
  - 可选
  - 默认值：`Apple Books Notes`
- `pdf.enabled`
  - 可选
  - 默认值：`true`
- `pdf.renderer`
  - 可选
  - 可选值：`auto`、`swift`、`mutool`、`poppler`
  - 默认值：`auto`

### `absync doctor`

检查本机环境是否可以运行 `absync`。

```sh
absync doctor
```

它会检查 macOS、`sqlite3`、Apple Books 数据库、配置合法性、输出目录可写性、PDF 渲染器、CPU 架构和 Node.js 版本。为了测试可写性，它可能会在受管理输出目录里创建并删除一个很小的临时探针文件。

如果 Apple Books 数据库缺失或不可读，常见原因是：

- Apple Books 从未打开过，或没有本地资料库数据
- 当前不是 macOS
- `HOME` 被覆盖或隔离，导致 `absync` 去错误的用户容器下查找 Apple Books 数据

### `absync books`

列出可同步的 Apple Books 书籍。

```sh
absync books
absync books --json
```

这个命令读取本地 Apple Books 数据，不需要 `absync` 配置。可同步格式是 EPUB 和 PDF。

### `absync plan`

预览 `sync` 将会做什么，不写入文件。

```sh
absync plan
absync plan --book "Newton"
absync plan --json
```

计划结果会把书籍分为：

- `changed`：需要重新生成的书
- `removed`：之前同步过，但现在 Apple Books 中已经不存在的书
- `unchanged`：当前输出已经和 Apple Books 数据一致的书

运行 `absync plan --help` 查看完整 change reason。

### `absync sync`

写入变更的 Markdown 文件和受管理 PDF assets。

```sh
absync sync
absync sync --dry-run
absync sync --book "Newton"
```

`sync` 会先执行和 `plan` 相同的计划阶段。完整同步可能删除之前由 `absync` 管理、但现在已经过期的文件。带 `--book` 的过滤同步只更新匹配书籍，不处理删除。

受管理输出结构：

```text
<output.dir>/<output.managedDirName>/
  index.md
  books/
    <book>.md
  assets/
    covers/
      <asset-id>.png
    pdf/
      <asset-id>/
```

## 数据和写入边界

`absync` 读取：

- 当前 macOS 用户 `~/Library/Containers/...` 下的 Apple Books 本地数据库
- `~/Library/Application Support/apple-books-notes-sync/config.json` 下的配置文件

`absync` 写入：

- 执行 `absync config set`、`unset`、`edit` 时写配置
- 只在 `<output.dir>/<output.managedDirName>` 下写入受管理笔记和 assets
- 执行 `absync doctor` 时可能写入并删除一个临时可写性探针

`absync plan`、`absync books` 和 `absync sync --dry-run` 不会写入同步输出。

## 本地开发

```sh
npm install
npm run check
npm run install:local
absync --help
```

发布 dry run：

```sh
npm run pack:dry
```

## License

MIT
