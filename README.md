<div align="center">
  <h1>Apple Books Notes Sync</h1>
  <p>English | <a href="./README.zh-CN.md">中文</a></p>
  <p>
    <a href="https://www.npmjs.com/package/apple-books-notes-sync"><img alt="npm version" src="https://img.shields.io/npm/v/apple-books-notes-sync"></a>
    <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node >=20.16.0" src="https://img.shields.io/badge/node-%3E%3D20.16.0-brightgreen"></a>
  </p>
</div>

Apple Books Notes Sync is an Obsidian desktop plugin that syncs Apple Books highlights, notes, and PDF annotations into local Markdown notes.

The plugin uses a companion CLI, `absync`, to read local Apple Books data and run sync work outside Obsidian's UI process.

## Requirements

- macOS
- Obsidian desktop
- Apple Books with local library data
- Node.js `>=20.16.0`
- `sqlite3` available in `PATH`
- Optional PDF renderers: `swift`, `mutool` from `mupdf-tools`, or `pdftocairo` from `poppler`

The plugin is desktop-only. Mobile Obsidian is not supported.

## Installation

### Obsidian Plugin

Install Apple Books Notes Sync from Obsidian's Community Plugins browser when it is available there:

1. Open **Settings**.
2. Go to **Community plugins**.
3. Search for `Apple Books Notes Sync`.
4. Install and enable the plugin.

For manual installation, copy the release files into:

```text
<vault>/.obsidian/plugins/apple-books-notes-sync/
```

The plugin folder should contain:

- `main.js`
- `manifest.json`
- `styles.css` if included in the release
- `tools/` if included in the release

Then reload Obsidian and enable Apple Books Notes Sync from **Community plugins**.

### Companion CLI

Install the CLI companion from Terminal:

```sh
npm install -g apple-books-notes-sync
```

You can verify it with:

```sh
absync --help
```

## First Run

After enabling the plugin:

1. Open Apple Books Notes Sync settings in Obsidian.
2. Click **Detect** next to **absync CLI path**.
3. Click **Test** to verify the CLI.
4. Run **Doctor**, **Plan**, or **Sync** from the command palette.

The default managed output folder is:

```text
<vault>/Apple Books Notes
```

If you run Sync before configuring the CLI path, the plugin will show setup instructions with the install command and path detection command.

## Usage

Apple Books Notes Sync adds these Obsidian commands:

- `Apple Books Notes Sync: Sync`
- `Apple Books Notes Sync: Plan`
- `Apple Books Notes Sync: Doctor`
- `Apple Books Notes Sync: Create Books.base`

The ribbon icon runs Sync.

`Create Books.base` creates an Obsidian Bases view at `<managedDirName>/Books.base` for browsing synced book notes. Existing `.base` files are not overwritten by default, and Sync never removes or rewrites `.base` files.

## Features

- Sync EPUB highlights and notes into Markdown.
- Sync PDF annotations and rendered PDF page images.
- Split heavily annotated EPUB/PDF books into chapter notes.
- Preserve interactive note properties such as `sync_paused` and `chapter_notes`.
- Create a `Books.base` view for synced book notes.
- Store cover images and PDF page assets inside the managed folder.
- Use `absync` directly for automation.

## Settings

- **Managed folder [default: Apple Books Notes]**: Folder inside the current vault where generated notes and assets are written.
- **Books Base**: Create the Obsidian Bases view for synced book notes.
- **absync CLI path**: Full path to the `absync` CLI. Use **Detect** to find and save it automatically.
- **PDF notes [default: auto]**: Controls whether PDF annotations are synced and which renderer is used for PDF page images.
- **PDF page opener [default: Microsoft Edge]**: App used when opening a PDF page link from generated notes.

## Output

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

The CLI is mainly for automation and troubleshooting. Common commands:

```sh
absync doctor
absync plan
absync sync
absync base create
```

See [docs/user/CLI.md](docs/user/CLI.md) for the full CLI reference.

## FAQ

### Why does this plugin need a CLI?

Reading Apple Books databases and rendering PDF assets can take time. The plugin keeps Obsidian responsive by launching `absync` as a child process instead of doing sync work inside Obsidian's UI process.

### Does Sync overwrite my edits?

Generated book notes have managed properties and generated body content. Interactive properties such as `sync_paused` and `chapter_notes` are preserved. Sync does not overwrite or remove `.base` files.

### Where are files written?

By default, files are written under `<vault>/Apple Books Notes`. You can change this from the plugin settings.

### Can I use the CLI without Obsidian?

The CLI expects a target Obsidian vault with this plugin installed and enabled, because it reads vault-scoped plugin settings.

## For Contributors

Developer notes live in [docs/internal/ARCHITECTURE.md](docs/internal/ARCHITECTURE.md). Run the project checks with:

```sh
npm run check
```

## Releasing

Build both release surfaces with:

```sh
npm run build
```

The plugin release staging directory is `plugin-dist/`. It contains the files Obsidian expects in a GitHub release, including `main.js`, `manifest.json`, optional `styles.css`, and bundled helper tools.
