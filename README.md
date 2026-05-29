# apple-books-notes-sync

[中文说明](./README.zh-CN.md)

Sync Apple Books highlights and notes to local Markdown files for Obsidian.

`apple-books-notes-sync` installs the `absync` command. It reads the current
macOS user's local Apple Books database, plans what changed, and writes managed
Markdown output into an Obsidian vault folder.

## Install

```sh
npm install -g apple-books-notes-sync
absync --help
```

You can also run it without a global install:

```sh
npx apple-books-notes-sync --help
```

Requirements:

- macOS
- Node.js `>=20.16.0`
- Apple Books with local library data
- An Obsidian vault if you want to sync notes
- `sqlite3` available in `PATH`
- Optional PDF renderers: `mutool` from `mupdf-tools`, or `pdftocairo` from `poppler`

## First Run

Set the Obsidian vault root. This must be the vault folder itself, not the
managed Apple Books notes subfolder.

```sh
absync config set output.dir "/path/to/ObsidianVault"
```

Then inspect the environment and preview changes before writing files:

```sh
absync doctor
absync books
absync plan
absync sync
```

The default managed output directory is:

```text
<output.dir>/Apple Books Notes
```

You can change the managed folder name:

```sh
absync config set output.managedDirName "Apple Books Notes"
```

## Finding Your Way Around

`absync` keeps operational details close to the commands themselves. The root
help gives the workflow, and each command explains its own options, rules, and
examples.

Start here:

```sh
absync --help
```

Then open the next level of documentation with command-local `--help`:

```sh
absync config --help
absync config set --help
absync plan --help
absync sync --help
absync books --help
absync doctor --help
```

The `help` subcommand is intentionally disabled. Use `--help`:

```sh
absync --help
absync sync --help
```

When in doubt:

- Start from `absync --help`.
- Read command-local `--help` before using a command that may write files.
- Run `absync plan` before `absync sync`.
- Use `--json` on `books` and `plan` when stable structured output is useful.
- Do not override `HOME` unless you intentionally want Apple Books data lookup
  to happen under that home directory.
- Use `absync config --help` or `absync config set --help` for config keys and
  accepted values.

## Commands

### `absync config`

Manage configuration stored at:

```text
~/Library/Application Support/apple-books-notes-sync/config.json
```

Common operations:

```sh
absync config
absync config path
absync config list
absync config get output.dir
absync config set output.dir "/path/to/ObsidianVault"
absync config unset output.dir
absync config edit
```

Config keys:

- `output.dir`
  - Required for `plan` and `sync`
  - Must be an existing Obsidian vault root
  - Must contain `.obsidian/`
- `output.managedDirName`
  - Optional
  - Default: `Apple Books Notes`
- `pdf.enabled`
  - Optional
  - Default: `true`
- `pdf.renderer`
  - Optional
  - One of: `auto`, `swift`, `mutool`, `poppler`
  - Default: `auto`

### `absync doctor`

Check whether the local environment can run `absync`.

```sh
absync doctor
```

It checks macOS, `sqlite3`, Apple Books databases, config validity, output
writability, PDF renderers, CPU architecture, and Node.js version. It may create
and remove a tiny temporary probe file inside the managed output directory to
test writability.

If Apple Books databases are missing or unreadable, common causes are:

- Apple Books has never been opened or has no local library data
- The command is not running on macOS
- `HOME` was overridden or isolated, so `absync` is looking in the wrong user
  container

### `absync books`

List syncable Apple Books items.

```sh
absync books
absync books --json
```

This command reads local Apple Books data and does not require `absync` config.
Syncable formats are EPUB and PDF.

### `absync plan`

Preview what `sync` would do without writing files.

```sh
absync plan
absync plan --book "Newton"
absync plan --json
```

The plan groups books into:

- `changed`: books that would be regenerated
- `removed`: previously synced books that no longer exist in Apple Books
- `unchanged`: books that already match current Apple Books data

Run `absync plan --help` for the full list of change reasons.

### `absync sync`

Write changed Markdown files and managed PDF assets.

```sh
absync sync
absync sync --dry-run
absync sync --book "Newton"
```

`sync` runs the same planning phase as `plan`. A full sync may remove stale files
that were previously managed by `absync`. A filtered sync with `--book` updates
matching books only and does not process removals.

Managed output layout:

```text
<output.dir>/<output.managedDirName>/
  index.md
  books/
    <book>.md
  assets/
    pdf/
      <asset-id>/
```

## Data and Write Boundaries

`absync` reads:

- Apple Books local databases under the current macOS user's
  `~/Library/Containers/...`
- The config file under
  `~/Library/Application Support/apple-books-notes-sync/config.json`

`absync` writes:

- Config changes when using `absync config set`, `unset`, or `edit`
- Managed notes and assets only under `<output.dir>/<output.managedDirName>`
- A temporary writability probe during `absync doctor`

`absync plan`, `absync books`, and `absync sync --dry-run` do not write managed
sync output.

## Local Development

```sh
npm install
npm run check
npm run install:local
absync --help
```

Release dry run:

```sh
npm run pack:dry
```

## License

MIT
