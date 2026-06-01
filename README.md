<div align="center">
  <h1>apple-books-notes-sync</h1>
  <p>English | <a href="./README.zh-CN.md">中文</a></p>
  <p>
    <a href="https://www.npmjs.com/package/apple-books-notes-sync"><img alt="npm version" src="https://img.shields.io/npm/v/apple-books-notes-sync"></a>
    <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=20.16.0" src="https://img.shields.io/badge/node-%3E%3D20.16.0-brightgreen"></a>
  </p>
</div>

Sync Apple Books highlights and notes to local Markdown files for Obsidian.

This project ships two surfaces:

- An Obsidian desktop plugin for vault-scoped settings and in-app commands.
- The `absync` CLI companion for automation against a vault where the plugin is
  installed and enabled.

## Requirements

- macOS
- Obsidian desktop
- Node.js `>=20.16.0` for CLI use
- Apple Books with local library data
- `sqlite3` available in `PATH`
- Optional PDF renderers: `swift`, `mutool` from `mupdf-tools`, or
  `pdftocairo` from `poppler`

The plugin is desktop-only. Mobile Obsidian is not supported.

## CLI Install

```sh
npm install -g apple-books-notes-sync
absync --help
```

You can also run it without a global install:

```sh
npx apple-books-notes-sync --help
```

The CLI no longer stores global configuration. It discovers Obsidian vaults and
uses the Apple Books Notes Sync plugin settings inside the selected vault.

## First Run

Install and enable the Obsidian plugin in the target vault, then configure the
plugin settings inside Obsidian. The default managed output folder is:

```text
<vault>/Apple Books Notes
```

Then inspect the environment and preview changes before writing files:

```sh
absync vaults
absync doctor
absync books
absync plan
absync sync
```

If more than one vault is available, pass a vault selector:

```sh
absync sync --vault "MyVault"
absync sync --vault c957b104655c94aa
absync sync --vault "/path/to/MyVault"
```

Selectors resolve in this order: Obsidian vault ID, vault name, absolute path.
Duplicate vault names are rejected so you can choose a precise ID or path.

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

This command reads local Apple Books data and does not require a target vault.
Syncable formats are EPUB and PDF.

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

Managed output layout:

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

## Development

Build both release surfaces:

```sh
npm run build
```

For local plugin development, copy `.env.template` to `.env.local`, set
`OBSIDIAN_DEV_VAULT`, then run:

```sh
npm run install:plugin
```

The plugin release staging directory is `plugin-dist/`. It contains the files
Obsidian expects in a GitHub release: `main.js`, `manifest.json`, and optional
`styles.css`.
