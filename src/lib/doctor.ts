import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBooks } from "./ibooks-data";
import { detectPdfRendererAvailability, resolvePdfRenderBackend } from "./pdf";
import { sqliteVersion } from "./sqlite";
import type { ConfigValidationError } from "./config";
import type { CliConfig, IBooksPaths } from "./types";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
  summary: {
    books: number;
    epubBooks: number;
    pdfBooks: number;
    unsupportedBooks: number;
  };
};

async function canRead(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function canWriteDir(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.probe-${Date.now()}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function formatAppleBooksUnavailableDetail(): string {
  return [
    "Apple Books databases are missing or unreadable.",
    "Possible causes: Apple Books/iBooks is not installed or initialized,",
    "this is not macOS, or HOME was overridden/isolated.",
    "Expected current-user data under ~/Library/Containers/com.apple.iBooksX/.",
  ].join(" ");
}

function isSyncableFormat(format: string): boolean {
  return format === "EPUB" || format === "PDF";
}

export async function runDoctor(
  paths: IBooksPaths,
  config: CliConfig | null,
  configError: ConfigValidationError | null = null,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  const isMacos = process.platform === "darwin";
  checks.push({
    name: "macOS environment",
    ok: isMacos,
    detail: `platform=${process.platform}`,
  });

  try {
    const version = sqliteVersion();
    checks.push({
      name: "sqlite3 available",
      ok: true,
      detail: version,
    });
  } catch (error: unknown) {
    checks.push({
      name: "sqlite3 available",
      ok: false,
      detail: error instanceof Error ? error.message : "not available",
    });
  }

  const libraryDbReadable = await canRead(paths.libraryDbPath);
  checks.push({
    name: "BKLibrary readable",
    ok: libraryDbReadable,
    detail: paths.libraryDbPath,
  });

  const annotationDbReadable = await canRead(paths.annotationDbPath);
  checks.push({
    name: "AEAnnotation readable",
    ok: annotationDbReadable,
    detail: paths.annotationDbPath,
  });

  checks.push({
    name: "Books.plist readable",
    ok: await canRead(paths.booksPlistPath),
    detail: paths.booksPlistPath,
  });

  const pdfRendererAvailability = detectPdfRendererAvailability();
  checks.push({
    name: "mutool available",
    ok: true,
    detail: pdfRendererAvailability.mutool
      ? "mutool found"
      : "not found (optional, install: brew install mupdf-tools)",
  });
  checks.push({
    name: "pdftocairo available",
    ok: true,
    detail: pdfRendererAvailability.poppler
      ? "pdftocairo found"
      : "not found (optional, install: brew install poppler)",
  });

  if (paths.epubInfoDbPath) {
    checks.push({
      name: "EPUB info cache readable",
      ok: await canRead(paths.epubInfoDbPath),
      detail: paths.epubInfoDbPath,
    });
  } else {
    checks.push({
      name: "EPUB info cache readable",
      ok: false,
      detail: "AEEpubInfoSource database not found (publisher may be unavailable)",
    });
  }

  let books = 0;
  let epubBooks = 0;
  let pdfBooks = 0;
  let unsupportedBooks = 0;
  if (!isMacos || !libraryDbReadable || !annotationDbReadable) {
    checks.push({
      name: "Apple Books data query",
      ok: false,
      detail: formatAppleBooksUnavailableDetail(),
    });
  } else {
    try {
      const list = readBooks(paths.libraryDbPath, paths.annotationDbPath, paths.epubInfoDbPath);
      epubBooks = list.filter((book) => book.format === "EPUB").length;
      pdfBooks = list.filter((book) => book.format === "PDF").length;
      books = epubBooks + pdfBooks;
      unsupportedBooks = list.filter((book) => !isSyncableFormat(book.format)).length;
      checks.push({
        name: "Apple Books data query",
        ok: true,
        detail: `syncable=${books}, epub=${epubBooks}, pdf=${pdfBooks}, unsupported=${unsupportedBooks}`,
      });
    } catch {
      checks.push({
        name: "Apple Books data query",
        ok: false,
        detail: formatAppleBooksUnavailableDetail(),
      });
    }
  }

  if (config) {
    if (!config.outputDir) {
      checks.push({
        name: "config",
        ok: false,
        detail: "Missing required config: output.dir Run: absync config set output.dir <path-to-obsidian-vault>",
      });
    } else {
    const managedOutput = path.join(config.outputDir, config.managedDirName);
    const writable = await canWriteDir(managedOutput);
    checks.push({
      name: "output directory writable",
      ok: writable,
      detail: managedOutput,
    });

    try {
      const activePdfRenderer = resolvePdfRenderBackend(config.pdfRenderBackend, pdfRendererAvailability);
      checks.push({
        name: "pdf renderer config",
        ok: true,
        detail: `configured=${config.pdfRenderBackend}, active=${activePdfRenderer}`,
      });
    } catch (error: unknown) {
      checks.push({
        name: "pdf renderer config",
        ok: false,
        detail: error instanceof Error ? error.message : "invalid renderer configuration",
      });
    }
    }
  } else if (configError) {
    checks.push({
      name: "config",
      ok: false,
      detail: configError.message.replace(/\n/g, " "),
    });
  } else {
    checks.push({
      name: "config",
      ok: false,
      detail: "config unavailable",
    });
  }

  checks.push({
    name: "cpu architecture",
    ok: true,
    detail: `${os.arch()} / node ${process.version}`,
  });

  return {
    ok: checks.every((check) => check.ok),
    checks,
    summary: { books, epubBooks, pdfBooks, unsupportedBooks },
  };
}
