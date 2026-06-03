# CLI 文档

`absync` 是 Apple Books Notes Sync 的 companion CLI。它读取本机 Apple Books 数据，并为已安装且启用本插件的目标 Obsidian vault 写入同步后的 Markdown 输出。

## 安装

```sh
npm install -g apple-books-notes-sync
absync --help
```

也可以不全局安装：

```sh
npx apple-books-notes-sync --help
```

CLI 不保存全局配置。它会发现 Obsidian vault，并读取目标 vault 内 Apple Books Notes Sync 插件的设置。

## 选择 Vault

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

### `absync base create`

创建用于浏览同步书籍笔记的 Obsidian Bases 视图。默认写入 `<managedDirName>/Books.base`，且不会覆盖已有文件。

```sh
absync base create
absync base create --vault "MyVault"
absync base create --path "Apple Books Notes/Books.base"
absync base create --overwrite
```

## 输出目录

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

## 规则

- `absync sync` 只写入所选 vault 的受管理输出目录。
- `absync base create` 只写入指定的 vault 相对路径 `.base` 文件。
- 完整同步可能删除此前由 `absync` 管理、但现在已经过期的文件。
- Sync 永远不会覆盖或删除 `.base` 文件。
