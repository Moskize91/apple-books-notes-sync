# CLI Reference

`absync` is the companion CLI used by Apple Books Notes Sync. It reads local Apple Books data and writes synced Markdown output for a target Obsidian vault where the plugin is installed and enabled.

## Install

```sh
npm install -g apple-books-notes-sync
absync --help
```

You can also run it without a global install:

```sh
npx apple-books-notes-sync --help
```

The CLI does not store global configuration. It discovers Obsidian vaults and reads Apple Books Notes Sync plugin settings inside the selected vault.

## Vault Selection

If more than one vault is available, pass a vault selector:

```sh
absync sync --vault "MyVault"
absync sync --vault c957b104655c94aa
absync sync --vault "/path/to/MyVault"
```

Selectors resolve in this order: Obsidian vault ID, vault name, absolute path. Duplicate vault names are rejected so you can choose a precise ID or path.

## Commands

### `absync vaults`

List Obsidian vaults discovered from Obsidian's global app data.

```sh
absync vaults
absync vaults --json
```

### `absync doctor`

Check whether the local environment and selected vault can run sync.

```sh
absync doctor
absync doctor --vault "MyVault"
```

### `absync books`

List syncable Apple Books items.

```sh
absync books
absync books --json
```

This command reads local Apple Books data and does not require a target vault. Syncable formats are EPUB and PDF.

### `absync plan`

Preview what `sync` would do without writing files.

```sh
absync plan
absync plan --vault "MyVault"
absync plan --book "Newton"
absync plan --json
```

### `absync sync`

Write changed Markdown files and managed PDF assets.

```sh
absync sync
absync sync --vault "MyVault"
absync sync --dry-run
absync sync --book "Newton"
```

### `absync base create`

Create the Obsidian Bases view for synced book notes. By default this writes `<managedDirName>/Books.base` and does not overwrite an existing file.

```sh
absync base create
absync base create --vault "MyVault"
absync base create --path "Apple Books Notes/Books.base"
absync base create --overwrite
```

## Output Layout

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

## Rules

- `absync sync` writes only inside the managed output directory under the selected vault.
- `absync base create` writes only the requested vault-relative `.base` file.
- Full sync may remove stale files that were previously managed by `absync`.
- Sync never overwrites or removes `.base` files.
