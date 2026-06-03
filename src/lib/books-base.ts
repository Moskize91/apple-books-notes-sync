import path from "node:path";

export const DEFAULT_BOOKS_BASE_FILE_NAME = "Books.base";
export const BOOKS_DIR_NAME = "books";

export type BooksBaseOptions = {
  managedDirName: string;
};

export function normalizeVaultRelativePath(input: string, label = "path"): string {
  const trimmed = input.replace(/\\/g, "/").trim();
  if (path.posix.isAbsolute(trimmed)) {
    throw new Error(`${label} must stay inside the vault.`);
  }
  const raw = trimmed.replace(/^\/+|\/+$/g, "");
  if (raw.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  if (raw.includes("\0")) {
    throw new Error(`${label} must not contain NUL characters.`);
  }
  if (raw.split("/").includes("..")) {
    throw new Error(`${label} must stay inside the vault.`);
  }

  const normalized = path.posix.normalize(raw);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`${label} must stay inside the vault.`);
  }
  return normalized;
}

export function getBooksFolderRelativePath(managedDirName: string): string {
  return path.posix.join(normalizeVaultRelativePath(managedDirName, "managed folder"), BOOKS_DIR_NAME);
}

export function getDefaultBooksBaseRelativePath(managedDirName: string): string {
  return path.posix.join(normalizeVaultRelativePath(managedDirName, "managed folder"), DEFAULT_BOOKS_BASE_FILE_NAME);
}

export function renderBooksBase(options: BooksBaseOptions): string {
  const booksFolder = getBooksFolderRelativePath(options.managedDirName);
  return [
    "filters:",
    "  and:",
    `    - file.folder == ${JSON.stringify(booksFolder)}`,
    "formulas:",
    '  open_file: link(open_url.replace(/^\\[[^\\]]*\\]\\(<(.+)>\\)$/, "$1"), title)',
    "properties:",
    "  note.author:",
    "    displayName: Author",
    "  note.format:",
    "    displayName: Format",
    "  note.publisher:",
    "    displayName: Publisher",
    "  note.open_url:",
    "    displayName: Open file",
    "  formula.open_file:",
    "    displayName: Open file",
    "views:",
    "  - type: cards",
    "    name: Books",
    "    order:",
    "      - file.name",
    "      - author",
    "      - publisher",
    "      - formula.open_file",
    "    sort:",
    "      - property: last_modified_at",
    "        direction: DESC",
    "    image: note.cover",
    "    imageFit: contain",
    "    imageAspectRatio: 1.45",
    "",
  ].join("\n");
}
