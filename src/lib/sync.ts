import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { hydrateEpubPackageMetadata } from "./book-metadata";
import {
  readEpubAnnotationMaxModificationDates,
  readBooks,
  readEpubRenderableCounts,
  readEpubAnnotations,
} from "./ibooks-data";
import { buildBookFileRelativePathByAssetId, toShortBookFileStem } from "./book-file-name";
import { readEpubChapterOrderByKey, readEpubChapterTitleByKey, readEpubCoverImage, sortEpubAnnotations } from "./epub";
import { log } from "./logger";
import {
  extractPdfQuoteContent,
  extractPdfUserNoteContent,
  extractPdfPageAnnotations,
  limitPngMaxDimension,
  overlayPdfAnnotationNumbers,
  renderPdfCoverToPng,
  renderPdfPageToPng,
  resolvePdfRenderBackend,
  shouldOverlayPdfAnnotationRect,
  sortPdfAnnotations,
  toPdfNoteMarker,
} from "./pdf";
import {
  getEpubBookProperties,
  getPdfBookProperties,
  renderBookFrontmatterMarkdown,
  renderEpubBookMarkdown,
  renderIndexMarkdown,
  renderPdfBookMarkdown,
} from "./render-markdown";
import { acquireSyncLock, buildBookSyncHash, readSyncState, writeSyncState } from "./sync-state";
import { hasBookMarkdownPropertyDrift, mergeBookMarkdownProperties, readBookSyncPaused } from "./book-properties";
import type {
  Book,
  EpubAnnotation,
  IBooksPaths,
  PdfRenderBackend,
  SyncConfig,
  SyncAssetState,
  SyncStats,
  SyncableBookFormat,
  PdfPageAnnotations,
} from "./types";

export type SyncProgressEvent =
  | {
      type: "plan";
      totalBooks: number;
      changedBooks: number;
      unchangedBooks: number;
      removedBooks: number;
    }
  | {
      type: "book";
      phase: "dry-run preparing" | "syncing";
      index: number;
      total: number;
      assetId: string;
      title: string;
      format: SyncableBookFormat;
    }
  | {
      type: "warning";
      title: string;
      message: string;
    }
  | {
      type: "complete";
      successBooks: number;
      failedBooks: number;
      skippedBooks: number;
      generatedFiles: number;
    };

type SyncOptions = {
  dryRun: boolean;
  bookFilter?: string;
  onProgress?: (event: SyncProgressEvent) => void;
};

type SyncResult = {
  stats: SyncStats;
  outputDir: string;
};

type PdfPageRenderItem = {
  pageNumber: number;
  imageRelativePath: string | null;
  notes: Array<{ marker: string | null; quoteText: string; noteText: string; hasRect: boolean }>;
};

type PdfFileStamp = {
  mtimeMs: number;
  size: number;
};

type BookSyncSnapshot = {
  book: Book & { format: SyncableBookFormat };
  hash: string;
  bookFileRelativePath: string | null;
  pdfAssetDirRelativePath: string | null;
  coverImageRelativePath: string | null;
  pdfSourceModifiedAt: Date | null;
  syncPaused: boolean;
};

type BookFingerprint = {
  book: Book & { format: SyncableBookFormat };
  hash: string;
  shouldHaveOutput: boolean;
  pdfSourceModifiedAt: Date | null;
};

export type SyncPlanReason =
  | "new"
  | "unchanged"
  | "format-changed"
  | "content-changed"
  | "output-path-changed"
  | "legacy-output"
  | "missing-output"
  | "properties-changed"
  | "sync-paused"
  | "pdf-assets-missing"
  | "cover-assets-missing"
  | "removed";

export type SyncPlanRegenerateReason =
  | "new"
  | "format-changed"
  | "content-changed"
  | "output-path-changed";

export type SyncPlanComparableAsset = {
  format: SyncableBookFormat;
  hash: string;
  bookFileRelativePath: string | null;
};

export type SyncPlanBook = {
  assetId: string;
  title: string;
  author: string | null;
  format: SyncableBookFormat;
  annotationCount: number | null;
  bookFileRelativePath: string | null;
  reason: SyncPlanReason;
};

export type SyncPlanRemovedBook = {
  assetId: string;
  title: string;
  format: SyncableBookFormat;
  bookFileRelativePath: string | null;
  reason: "removed";
};

export type SyncPlan = {
  outputDir: string;
  booksDirName: string;
  isFullSync: boolean;
  allBooks: Array<Book & { format: SyncableBookFormat }>;
  selectedBooks: Array<Book & { format: SyncableBookFormat }>;
  bookSnapshots: BookSyncSnapshot[];
  changedSnapshots: BookSyncSnapshot[];
  previousStateAssets: Record<string, SyncAssetState>;
  nextStateAssets: Record<string, SyncAssetState>;
  bookFileRelativePathByAssetId: Map<string, string | null>;
  removedAssetIds: string[];
  changed: SyncPlanBook[];
  unchanged: SyncPlanBook[];
  removed: SyncPlanRemovedBook[];
  forcePdfResync: boolean;
  stats: {
    totalBooks: number;
    changedBooks: number;
    unchangedBooks: number;
    removedBooks: number;
  };
};

const LEGACY_PDF_FALLBACK_MARKER = "当前版本无法展开内容";
const OUTPUT_SCHEMA_VERSION = 43;
const PDF_PAGE_LINK_SCHEMA_VERSION = 5;
const PDF_IMAGE_MAX_DIMENSION = 1600;
const COVER_IMAGE_MAX_DIMENSION = 1200;

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

async function mapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function removeFileIfExists(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

async function removeDirectoryIfExists(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

function isSyncableBook(book: Book): book is Book & { format: SyncableBookFormat } {
  return book.format === "EPUB" || book.format === "PDF";
}

function filterBooks(books: Array<Book & { format: SyncableBookFormat }>, filter: string | undefined): Array<Book & { format: SyncableBookFormat }> {
  if (!filter) {
    return books;
  }

  const keyword = filter.toLowerCase();
  return books.filter((book) => {
    return (
      book.assetId.toLowerCase().includes(keyword) ||
      book.title.toLowerCase().includes(keyword) ||
      (book.author?.toLowerCase().includes(keyword) ?? false)
    );
  });
}

async function getPdfFileStamp(pdfPath: string | null): Promise<PdfFileStamp | "missing" | null> {
  if (!pdfPath) {
    return null;
  }

  try {
    const stat = await fs.stat(pdfPath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return "missing";
  }
}

async function isBookSourceAvailable(book: Book): Promise<boolean> {
  if (!book.path) {
    return false;
  }
  return pathExists(book.path);
}

export function hasRenderablePdfPageAnnotations(pages: PdfPageAnnotations[]): boolean {
  for (const page of pages) {
    for (const annotation of sortPdfAnnotations(page.annotations)) {
      if (extractPdfQuoteContent(annotation).length > 0 || extractPdfUserNoteContent(annotation).length > 0) {
        return true;
      }
    }
  }
  return false;
}

function toSyncStateAsset(
  snapshot: BookSyncSnapshot,
  bookFileRelativePath: string | null,
  pdfAssetDirRelativePath: string | null,
  coverImageRelativePath: string | null,
  lastSyncedAt: string | null,
): SyncAssetState {
  const stateTitle = bookFileRelativePath
    ? path.posix.basename(bookFileRelativePath, ".md")
    : toShortBookFileStem(snapshot.book.title);
  return {
    assetId: snapshot.book.assetId,
    title: stateTitle,
    format: snapshot.book.format,
    hash: snapshot.hash,
    lastSyncedAt,
    bookFileRelativePath,
    pdfAssetDirRelativePath,
    coverImageRelativePath,
  };
}

export function getSyncPlanRegenerateReason(
  current: SyncPlanComparableAsset,
  previous: SyncAssetState | undefined,
): SyncPlanRegenerateReason | null {
  if (!previous) {
    return "new";
  }

  if (previous.format !== current.format) {
    return "format-changed";
  }

  if (previous.hash !== current.hash) {
    return "content-changed";
  }

  if (previous.bookFileRelativePath !== current.bookFileRelativePath) {
    return "output-path-changed";
  }

  return null;
}

function shouldForcePdfResync(previousStateAssets: Record<string, SyncAssetState>, assetsRootExists: boolean): boolean {
  return Object.keys(previousStateAssets).length > 0 && !assetsRootExists;
}

async function hasLegacyPdfFallbackMarker(outputDir: string, previous: SyncAssetState | undefined): Promise<boolean> {
  if (!previous?.bookFileRelativePath) {
    return false;
  }

  const absolutePath = path.join(outputDir, previous.bookFileRelativePath);
  try {
    const content = await fs.readFile(absolutePath, "utf8");
    return content.includes(LEGACY_PDF_FALLBACK_MARKER);
  } catch {
    return false;
  }
}

async function hasLegacyEpubInternalChapterHeading(outputDir: string, previous: SyncAssetState | undefined): Promise<boolean> {
  if (!previous?.bookFileRelativePath) {
    return false;
  }

  const absolutePath = path.join(outputDir, previous.bookFileRelativePath);
  try {
    const content = await fs.readFile(absolutePath, "utf8");
    return /^##\s+.+\.x?html?\s*$/im.test(content);
  } catch {
    return false;
  }
}

async function hasMissingExpectedBookFile(outputDir: string, previous: SyncAssetState | undefined): Promise<boolean> {
  if (!previous?.bookFileRelativePath) {
    return false;
  }
  return !(await pathExists(path.join(outputDir, previous.bookFileRelativePath)));
}

async function readPreviousBookMarkdown(
  outputDir: string,
  bookFileRelativePath: string | null | undefined,
): Promise<string | null> {
  if (!bookFileRelativePath) {
    return null;
  }

  try {
    return await fs.readFile(path.join(outputDir, bookFileRelativePath), "utf8");
  } catch {
    return null;
  }
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${Date.now()}-${process.pid}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function replaceDirectoryAtomically(stagingDir: string, targetDir: string): Promise<void> {
  const targetParent = path.dirname(targetDir);
  await fs.mkdir(targetParent, { recursive: true });
  const backupDir = `${targetDir}.bak-${Date.now()}-${process.pid}`;
  const hadTarget = await pathExists(targetDir);

  try {
    if (hadTarget) {
      await fs.rename(targetDir, backupDir);
    }
    await fs.rename(stagingDir, targetDir);
    if (hadTarget) {
      await removeDirectoryIfExists(backupDir);
    }
  } catch (error) {
    if (await pathExists(targetDir)) {
      await removeDirectoryIfExists(targetDir);
    }
    if (await pathExists(backupDir)) {
      await fs.rename(backupDir, targetDir);
    }
    if (await pathExists(stagingDir)) {
      await removeDirectoryIfExists(stagingDir);
    }
    throw error;
  }
}

async function generatePdfPages(
  book: Book,
  bookAssetDir: string,
  dryRun: boolean,
  pdfRenderBackend: PdfRenderBackend,
): Promise<PdfPageRenderItem[]> {
  if (!book.path) {
    return [];
  }

  const pages = await extractPdfPageAnnotations(book.path);
  const items: PdfPageRenderItem[] = [];

  for (const page of pages) {
    const renderableAnnotations = sortPdfAnnotations(page.annotations)
      .map((annotation) => {
        const quoteText = extractPdfQuoteContent(annotation);
        let noteText = extractPdfUserNoteContent(annotation);
        if (
          quoteText.length > 0 &&
          noteText.length > 0 &&
          quoteText.replace(/\s+/g, " ").trim() === noteText.replace(/\s+/g, " ").trim()
        ) {
          noteText = "";
        }
        return {
          annotation,
          quoteText,
          noteText,
        };
      })
      .filter((item) => item.quoteText.length > 0 || item.noteText.length > 0);
    if (renderableAnnotations.length === 0) {
      continue;
    }

    const hasMultipleNotes = renderableAnnotations.length > 1;
    const numbered = renderableAnnotations.map((item, index) => {
      return {
        ...item,
        marker: hasMultipleNotes ? toPdfNoteMarker(index + 1) : null,
      };
    });

    const imageName = `page-${page.pageNumber}.png`;
    const imageRelativePath = path.posix.join("assets", "pdf", book.assetId, imageName);
    const imageAbsolutePath = path.join(bookAssetDir, imageName);

    if (!dryRun) {
      await fs.mkdir(bookAssetDir, { recursive: true });
      renderPdfPageToPng(book.path, page.pageNumber, imageAbsolutePath, 2, pdfRenderBackend);
      await limitPngMaxDimension(imageAbsolutePath, PDF_IMAGE_MAX_DIMENSION);

      const overlayRects = numbered
        .filter((item) => item.annotation.rect)
        .map((item) => {
          return {
            marker: hasMultipleNotes ? item.marker : null,
            rect: item.annotation.rect!,
            drawRect: shouldOverlayPdfAnnotationRect(item.annotation),
          };
        })
        .filter((item) => {
          return item.drawRect || Boolean(item.marker);
        });

      await overlayPdfAnnotationNumbers(imageAbsolutePath, page.pageWidth, page.pageHeight, overlayRects);
    }

    const notes = numbered.map((item) => {
      return {
        marker: item.marker,
        quoteText: item.quoteText,
        noteText: item.noteText,
        hasRect: Boolean(item.annotation.rect),
      };
    });

    items.push({
      pageNumber: page.pageNumber,
      imageRelativePath: dryRun ? null : imageRelativePath,
      notes,
    });
  }

  return items;
}

async function writeCoverPngFromBuffer(input: Buffer, outputPath: string): Promise<boolean> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const inputPath = `${outputPath}.source`;
  try {
    await fs.writeFile(inputPath, input);
    execFileSync("sips", ["-s", "format", "png", "-Z", String(COVER_IMAGE_MAX_DIMENSION), inputPath, "--out", outputPath], {
      encoding: "utf8",
      stdio: "ignore",
    });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    log("warn", `failed to generate EPUB cover with sips: ${message}`);
    return false;
  } finally {
    await fs.rm(inputPath, { force: true });
  }
}

async function generateBookCover(
  book: Book & { format: SyncableBookFormat },
  coverImageAbsolutePath: string,
  dryRun: boolean,
  pdfRenderBackend: PdfRenderBackend,
): Promise<boolean> {
  if (!book.path) {
    return false;
  }

  if (book.format === "EPUB") {
    const coverBuffer = await readEpubCoverImage(book.path);
    if (!coverBuffer) {
      return false;
    }
    if (!dryRun) {
      return writeCoverPngFromBuffer(coverBuffer, coverImageAbsolutePath);
    }
    return true;
  }

  if (book.format === "PDF") {
    if (!dryRun) {
      await fs.mkdir(path.dirname(coverImageAbsolutePath), { recursive: true });
      renderPdfCoverToPng(book.path, coverImageAbsolutePath, 2, pdfRenderBackend);
      await limitPngMaxDimension(coverImageAbsolutePath, COVER_IMAGE_MAX_DIMENSION);
    }
    return true;
  }

  return false;
}

function buildAnnotationsByAssetId(
  annotations: EpubAnnotation[],
  assetIds: Set<string>,
): Map<string, EpubAnnotation[]> {
  const byAssetId = new Map<string, EpubAnnotation[]>();
  for (const annotation of annotations) {
    if (!assetIds.has(annotation.assetId)) {
      continue;
    }
    const list = byAssetId.get(annotation.assetId) ?? [];
    list.push(annotation);
    byAssetId.set(annotation.assetId, list);
  }
  return byAssetId;
}

async function buildBookFingerprint(
  book: Book & { format: SyncableBookFormat },
  epubAnnotationMaxModificationDates: Map<string, number | null>,
  epubRenderableCounts: Map<string, number>,
  previousStateAssets: Record<string, SyncAssetState>,
  syncPdfNotes: boolean,
): Promise<BookFingerprint> {
  const previous = previousStateAssets[book.assetId];
  const annotationModifiedAtForHash =
    book.format === "PDF" ? null : epubAnnotationMaxModificationDates.get(book.assetId) ?? null;
  const sourceAvailable = await isBookSourceAvailable(book);
  if (!sourceAvailable) {
    const unavailableHash =
      previous?.hash ??
      `${buildBookSyncHash(book.format, annotationModifiedAtForHash, "missing")}|schema:${OUTPUT_SCHEMA_VERSION}`;
    return {
      book,
      hash: unavailableHash,
      shouldHaveOutput: Boolean(previous?.bookFileRelativePath),
      pdfSourceModifiedAt: null,
    };
  }

  const pdfFileStamp = book.format === "PDF" ? await getPdfFileStamp(book.path) : null;
  const pdfSourceModifiedAt =
    pdfFileStamp && pdfFileStamp !== "missing" ? new Date(pdfFileStamp.mtimeMs) : null;
  const baseHash = buildBookSyncHash(book.format, annotationModifiedAtForHash, pdfFileStamp);
  const hash =
    book.format === "PDF"
      ? `${baseHash}|schema:${OUTPUT_SCHEMA_VERSION}|pdf-link:${PDF_PAGE_LINK_SCHEMA_VERSION}`
      : `${baseHash}|schema:${OUTPUT_SCHEMA_VERSION}`;
  let shouldHaveOutput: boolean;
  if (book.format === "EPUB") {
    shouldHaveOutput =
      (epubRenderableCounts.get(book.assetId) ?? 0) > 0 || Boolean(previousStateAssets[book.assetId]?.bookFileRelativePath);
  } else {
    shouldHaveOutput = Boolean(
      previous?.bookFileRelativePath ||
        (syncPdfNotes && book.path && (!previous || previous.hash !== hash)),
    );
  }

  return {
    book,
    hash,
    shouldHaveOutput,
    pdfSourceModifiedAt,
  };
}

function toPlanBook(snapshot: BookSyncSnapshot, reason: SyncPlanReason): SyncPlanBook {
  return {
    assetId: snapshot.book.assetId,
    title: snapshot.book.title,
    author: snapshot.book.author,
    format: snapshot.book.format,
    annotationCount: snapshot.book.annotationCount,
    bookFileRelativePath: snapshot.bookFileRelativePath,
    reason,
  };
}

function renderBookMarkdownForSnapshot(
  snapshot: BookSyncSnapshot,
  epubNotes: EpubAnnotation[],
  epubChapterTitleByKey: Map<string, string> | undefined,
  epubChapterOrderByKey: Map<string, number> | undefined,
  pdfPages: PdfPageRenderItem[],
  coverImagePropertyValue: string | null,
  vaultName: string | null,
): string {
  return snapshot.book.format === "EPUB"
    ? renderEpubBookMarkdown(
        snapshot.book,
        epubNotes,
        epubChapterTitleByKey,
        epubChapterOrderByKey,
        coverImagePropertyValue,
      )
    : renderPdfBookMarkdown(
        snapshot.book,
        pdfPages,
        coverImagePropertyValue,
        snapshot.pdfSourceModifiedAt,
        vaultName,
      );
}

function renderBookFrontmatterForSnapshot(
  snapshot: BookSyncSnapshot,
  epubAnnotationCount: number,
  pdfAnnotatedPages: number,
  coverImagePropertyValue: string | null,
): string {
  const properties =
    snapshot.book.format === "EPUB"
      ? getEpubBookProperties(snapshot.book, epubAnnotationCount, coverImagePropertyValue)
      : getPdfBookProperties(
          snapshot.book,
          pdfAnnotatedPages,
          coverImagePropertyValue,
          snapshot.pdfSourceModifiedAt,
        );
  return renderBookFrontmatterMarkdown(properties);
}

function readExistingPdfAnnotatedPages(markdown: string | null): number {
  if (!markdown) {
    return 0;
  }

  const matches = markdown.match(/<a href="[^"]*">第 \d+ 页<\/a>/g);
  return matches?.length ?? 0;
}

function toObsidianWikilink(managedDirName: string, relativePath: string | null): string | null {
  if (!relativePath) {
    return null;
  }
  return `[[${path.posix.join(managedDirName, relativePath)}]]`;
}

function toRemovedPlanBook(asset: SyncAssetState): SyncPlanRemovedBook {
  return {
    assetId: asset.assetId,
    title: asset.title,
    format: asset.format,
    bookFileRelativePath: asset.bookFileRelativePath,
    reason: "removed",
  };
}

export async function buildSyncPlan(
  config: SyncConfig,
  paths: IBooksPaths,
  options: { bookFilter?: string | undefined },
): Promise<SyncPlan> {
  const allBooks = await hydrateEpubPackageMetadata(
    readBooks(paths.libraryDbPath, paths.annotationDbPath, paths.epubInfoDbPath).filter(isSyncableBook),
  );
  const books = filterBooks(allBooks, options.bookFilter);
  const isFullSync = !options.bookFilter;

  const outputDir = path.resolve(config.vaultDir, config.managedDirName);
  const booksDirName = "books";
  const previousState = await readSyncState(outputDir);
  const nextStateAssets: Record<string, SyncAssetState> = { ...previousState.assets };
  for (const asset of Object.values(nextStateAssets)) {
    if (!asset.lastSyncedAt && previousState.updatedAt && previousState.updatedAt !== new Date(0).toISOString()) {
      asset.lastSyncedAt = previousState.updatedAt;
    }
  }

  const epubAnnotationMaxModificationDates = readEpubAnnotationMaxModificationDates(
    paths.annotationDbPath,
    paths.libraryDbPath,
  );
  const epubRenderableCounts = readEpubRenderableCounts(paths.annotationDbPath, paths.libraryDbPath);
  const allBookFingerprints = await mapConcurrent(books, 2, (book) => {
    return buildBookFingerprint(
      book,
      epubAnnotationMaxModificationDates,
      epubRenderableCounts,
      previousState.assets,
      config.syncPdfNotes,
    );
  });
  const fingerprintByAssetId = new Map<string, BookFingerprint>();
  const hasOutputByAssetId = new Map<string, boolean>();
  for (const fingerprint of allBookFingerprints) {
    fingerprintByAssetId.set(fingerprint.book.assetId, fingerprint);
    hasOutputByAssetId.set(fingerprint.book.assetId, fingerprint.shouldHaveOutput);
  }
  for (const book of allBooks) {
    if (hasOutputByAssetId.has(book.assetId)) {
      continue;
    }
    hasOutputByAssetId.set(book.assetId, Boolean(previousState.assets[book.assetId]?.bookFileRelativePath));
  }
  const bookFileRelativePathByAssetId = buildBookFileRelativePathByAssetId(
    allBooks,
    hasOutputByAssetId,
    booksDirName,
  );

  const bookSnapshots: BookSyncSnapshot[] = books.map((book) => {
    const fingerprint = fingerprintByAssetId.get(book.assetId);
    const annotationModifiedAtForHash =
      book.format === "PDF" ? null : epubAnnotationMaxModificationDates.get(book.assetId) ?? null;
    const hash =
      fingerprint?.hash ??
      `${buildBookSyncHash(book.format, annotationModifiedAtForHash, null)}|schema:${OUTPUT_SCHEMA_VERSION}`;
    const bookFileRelativePath = bookFileRelativePathByAssetId.get(book.assetId) ?? null;
    return {
      book,
      hash,
      bookFileRelativePath,
      pdfAssetDirRelativePath:
        book.format === "PDF" && bookFileRelativePath
          ? path.posix.join("assets", "pdf", book.assetId)
          : null,
      coverImageRelativePath: bookFileRelativePath ? path.posix.join("assets", "covers", `${book.assetId}.png`) : null,
      pdfSourceModifiedAt: fingerprint?.pdfSourceModifiedAt ?? null,
      syncPaused: false,
    };
  });

  await Promise.all(
    bookSnapshots.map(async (snapshot) => {
      const previous = previousState.assets[snapshot.book.assetId];
      if (!previous?.bookFileRelativePath) {
        return;
      }
      const existingMarkdown = await readPreviousBookMarkdown(outputDir, previous.bookFileRelativePath);
      snapshot.syncPaused = readBookSyncPaused(existingMarkdown);
    }),
  );

  for (const snapshot of bookSnapshots) {
    const existing = nextStateAssets[snapshot.book.assetId];
    if (!existing || snapshot.syncPaused) {
      continue;
    }
    nextStateAssets[snapshot.book.assetId] = {
      ...existing,
      title: snapshot.bookFileRelativePath
        ? path.posix.basename(snapshot.bookFileRelativePath, ".md")
        : toShortBookFileStem(snapshot.book.title),
      bookFileRelativePath: snapshot.bookFileRelativePath,
      pdfAssetDirRelativePath: snapshot.pdfAssetDirRelativePath,
    };
  }

  const assetsRootExists = await pathExists(path.join(outputDir, "assets"));
  const forcePdfResync = shouldForcePdfResync(previousState.assets, assetsRootExists);

  const changedSnapshots: BookSyncSnapshot[] = [];
  const changed: SyncPlanBook[] = [];
  const unchanged: SyncPlanBook[] = [];
  for (const snapshot of bookSnapshots) {
    if (forcePdfResync && snapshot.book.format === "PDF") {
      if (snapshot.syncPaused) {
        unchanged.push(toPlanBook(snapshot, "sync-paused"));
        continue;
      }
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "pdf-assets-missing"));
      continue;
    }

    const previous = previousState.assets[snapshot.book.assetId];
    const regenerateReason = getSyncPlanRegenerateReason(
      {
        format: snapshot.book.format,
        hash: snapshot.hash,
        bookFileRelativePath: snapshot.bookFileRelativePath,
      },
      previous,
    );
    if (regenerateReason) {
      if (snapshot.syncPaused) {
        unchanged.push(toPlanBook(snapshot, "sync-paused"));
        continue;
      }
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, regenerateReason));
      continue;
    }

    if (snapshot.book.format === "PDF" && (await hasLegacyPdfFallbackMarker(outputDir, previous))) {
      if (snapshot.syncPaused) {
        unchanged.push(toPlanBook(snapshot, "sync-paused"));
        continue;
      }
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "legacy-output"));
      continue;
    }

    if (snapshot.book.format === "EPUB" && (await hasLegacyEpubInternalChapterHeading(outputDir, previous))) {
      if (snapshot.syncPaused) {
        unchanged.push(toPlanBook(snapshot, "sync-paused"));
        continue;
      }
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "legacy-output"));
      continue;
    }

    if (await hasMissingExpectedBookFile(outputDir, previous)) {
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "missing-output"));
      continue;
    }

    if (snapshot.syncPaused) {
      unchanged.push(toPlanBook(snapshot, "sync-paused"));
      continue;
    }

    if (previous?.bookFileRelativePath && snapshot.bookFileRelativePath) {
      const existingMarkdown = await readPreviousBookMarkdown(outputDir, previous.bookFileRelativePath);
      const generatedFrontmatter = renderBookFrontmatterForSnapshot(
        snapshot,
        epubRenderableCounts.get(snapshot.book.assetId) ?? 0,
        readExistingPdfAnnotatedPages(existingMarkdown),
        toObsidianWikilink(config.managedDirName, previous.coverImageRelativePath),
      );
      if (hasBookMarkdownPropertyDrift(generatedFrontmatter, existingMarkdown)) {
        changedSnapshots.push(snapshot);
        changed.push(toPlanBook(snapshot, "properties-changed"));
        continue;
      }
    }

    unchanged.push(toPlanBook(snapshot, "unchanged"));
  }

  const allCurrentAssetIds = new Set(allBooks.map((book) => book.assetId));
  const removedAssetIds = isFullSync
    ? Object.keys(previousState.assets).filter((assetId) => {
        return !allCurrentAssetIds.has(assetId);
      })
    : [];
  const removed = removedAssetIds
    .map((assetId) => previousState.assets[assetId])
    .filter((asset): asset is SyncAssetState => Boolean(asset))
    .map(toRemovedPlanBook);

  return {
    outputDir,
    booksDirName,
    isFullSync,
    allBooks,
    selectedBooks: books,
    bookSnapshots,
    changedSnapshots,
    previousStateAssets: previousState.assets,
    nextStateAssets,
    bookFileRelativePathByAssetId,
    removedAssetIds,
    changed,
    unchanged,
    removed,
    forcePdfResync,
    stats: {
      totalBooks: books.length,
      changedBooks: changed.length,
      unchangedBooks: unchanged.length,
      removedBooks: removed.length,
    },
  };
}

export async function runSync(config: SyncConfig, paths: IBooksPaths, options: SyncOptions): Promise<SyncResult> {
  const plan = await buildSyncPlan(config, paths, { bookFilter: options.bookFilter });
  const {
    outputDir,
    booksDirName,
    isFullSync,
    allBooks,
    changedSnapshots,
    previousStateAssets,
    nextStateAssets,
    removedAssetIds,
  } = plan;
  const stagingRoot = path.join(outputDir, ".staging", `${Date.now()}-${process.pid}`);
  const syncStartedAt = new Date().toISOString();
  const vaultName = path.basename(path.resolve(config.vaultDir));

  const stats: SyncStats = {
    totalBooks: plan.stats.totalBooks,
    successBooks: 0,
    failedBooks: 0,
    skippedBooks: plan.stats.unchangedBooks,
    generatedFiles: 0,
  };

  const errors: Array<{ title: string; reason: string }> = [];

  if (plan.forcePdfResync) {
    log("info", "assets directory missing; all PDF books will be re-synced.");
  }

  const hasChangedPdfSnapshots = changedSnapshots.some((snapshot) => snapshot.book.format === "PDF");
  const shouldResolvePdfRenderer = config.syncPdfNotes && !options.dryRun && hasChangedPdfSnapshots;
  const resolvedPdfRenderBackend: PdfRenderBackend = shouldResolvePdfRenderer
    ? resolvePdfRenderBackend(config.pdfRenderBackend)
    : "auto";
  if (config.syncPdfNotes) {
    const activePdfRendererDetail = options.dryRun
      ? "dry-run(no render)"
      : hasChangedPdfSnapshots
        ? resolvedPdfRenderBackend
        : "skip(no changed pdf)";
    log("info", `pdf renderer: configured=${config.pdfRenderBackend}, active=${activePdfRendererDetail}`);
  }

  log(
    "info",
    `sync plan: changed=${plan.stats.changedBooks}, unchanged=${plan.stats.unchangedBooks}, removed=${plan.stats.removedBooks}`,
  );
  options.onProgress?.({
    type: "plan",
    totalBooks: plan.stats.totalBooks,
    changedBooks: plan.stats.changedBooks,
    unchangedBooks: plan.stats.unchangedBooks,
    removedBooks: plan.stats.removedBooks,
  });

  const changedEpubAssetIds = new Set(
    changedSnapshots
      .filter((snapshot) => snapshot.book.format === "EPUB")
      .map((snapshot) => snapshot.book.assetId),
  );

  let annotationsByAssetId = new Map<string, EpubAnnotation[]>();
  const chapterTitleByKeyByAssetId = new Map<string, Map<string, string>>();
  const chapterOrderByKeyByAssetId = new Map<string, Map<string, number>>();
  if (changedEpubAssetIds.size > 0) {
    const sortedEpubAnnotations = sortEpubAnnotations(readEpubAnnotations(paths.annotationDbPath, paths.libraryDbPath));
    annotationsByAssetId = buildAnnotationsByAssetId(sortedEpubAnnotations, changedEpubAssetIds);
    await Promise.all(
      changedSnapshots
        .filter((snapshot) => snapshot.book.format === "EPUB")
        .map(async (snapshot) => {
          const [chapterTitleByKey, chapterOrderByKey] = await Promise.all([
            readEpubChapterTitleByKey(snapshot.book.path),
            readEpubChapterOrderByKey(snapshot.book.path),
          ]);
          chapterTitleByKeyByAssetId.set(snapshot.book.assetId, chapterTitleByKey);
          chapterOrderByKeyByAssetId.set(snapshot.book.assetId, chapterOrderByKey);
        }),
    );
  }

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    if (!options.dryRun) {
      releaseLock = await acquireSyncLock(outputDir);
      await fs.mkdir(path.dirname(stagingRoot), { recursive: true });
      await removeDirectoryIfExists(stagingRoot);
      await fs.mkdir(stagingRoot, { recursive: true });
    }

    for (const [index, snapshot] of changedSnapshots.entries()) {
      const progress = `${index + 1}/${changedSnapshots.length}`;
      const action = options.dryRun ? "dry-run preparing" : "syncing";
      log("info", `${action} (${progress}) [${snapshot.book.format}] ${snapshot.book.title}`);
      options.onProgress?.({
        type: "book",
        phase: action,
        index: index + 1,
        total: changedSnapshots.length,
        assetId: snapshot.book.assetId,
        title: snapshot.book.title,
        format: snapshot.book.format,
      });

      const previousAssetState = previousStateAssets[snapshot.book.assetId];
      try {
        if (snapshot.bookFileRelativePath === null) {
          if (!options.dryRun) {
            if (previousAssetState?.bookFileRelativePath) {
              await removeFileIfExists(path.join(outputDir, previousAssetState.bookFileRelativePath));
            }
            if (previousAssetState?.pdfAssetDirRelativePath) {
              await removeDirectoryIfExists(path.join(outputDir, previousAssetState.pdfAssetDirRelativePath));
            }
            if (previousAssetState?.coverImageRelativePath) {
              await removeFileIfExists(path.join(outputDir, previousAssetState.coverImageRelativePath));
            }
            await removeDirectoryIfExists(path.join(outputDir, "assets", "pdf", snapshot.book.assetId));
            await removeFileIfExists(path.join(outputDir, "assets", "covers", `${snapshot.book.assetId}.png`));
          }
          nextStateAssets[snapshot.book.assetId] = toSyncStateAsset(snapshot, null, null, null, syncStartedAt);
          stats.successBooks += 1;
          continue;
        }

        let markdown = "";
        let generatedPdfImageCount = 0;
        let stagedPdfAssetDir = "";
        let generatedCoverImageCount = 0;
        let stagedCoverImagePath = "";
        let nextBookFileRelativePath: string | null = snapshot.bookFileRelativePath;
        let nextPdfAssetDirRelativePath: string | null = snapshot.pdfAssetDirRelativePath;
        let nextCoverImageRelativePath: string | null = snapshot.coverImageRelativePath;
        let epubNotes: EpubAnnotation[] = [];
        let epubChapterTitleByKey: Map<string, string> | undefined;
        let epubChapterOrderByKey: Map<string, number> | undefined;
        let pdfPages: PdfPageRenderItem[] = [];
        const canPreservePreviousOutput = previousAssetState?.bookFileRelativePath
          ? await pathExists(path.join(outputDir, previousAssetState.bookFileRelativePath))
          : false;

        if (snapshot.book.format === "EPUB") {
          epubNotes = annotationsByAssetId.get(snapshot.book.assetId) ?? [];
          epubChapterTitleByKey = chapterTitleByKeyByAssetId.get(snapshot.book.assetId);
          epubChapterOrderByKey = chapterOrderByKeyByAssetId.get(snapshot.book.assetId);
          if (epubNotes.length === 0) {
            nextBookFileRelativePath = canPreservePreviousOutput
              ? previousAssetState?.bookFileRelativePath ?? null
              : null;
            nextPdfAssetDirRelativePath = null;
            nextCoverImageRelativePath = canPreservePreviousOutput
              ? previousAssetState?.coverImageRelativePath ?? null
              : null;
          } else {
            nextBookFileRelativePath = snapshot.bookFileRelativePath;
          }
        } else {
          if (config.syncPdfNotes && snapshot.book.path) {
            stagedPdfAssetDir = path.join(stagingRoot, "assets", "pdf", snapshot.book.assetId);
            pdfPages = await generatePdfPages(
              snapshot.book,
              stagedPdfAssetDir,
              options.dryRun,
              resolvedPdfRenderBackend,
            );
            generatedPdfImageCount = pdfPages.filter((page) => page.imageRelativePath).length;
          }
          if (pdfPages.length === 0) {
            nextBookFileRelativePath = null;
            nextPdfAssetDirRelativePath = null;
            nextCoverImageRelativePath = null;
          } else {
            nextBookFileRelativePath = snapshot.bookFileRelativePath;
            nextPdfAssetDirRelativePath =
              generatedPdfImageCount > 0 ? path.posix.join("assets", "pdf", snapshot.book.assetId) : null;
          }
        }

        if (nextBookFileRelativePath && snapshot.coverImageRelativePath) {
          const targetCoverImagePath = path.join(outputDir, snapshot.coverImageRelativePath);
          if (await pathExists(targetCoverImagePath)) {
            nextCoverImageRelativePath = snapshot.coverImageRelativePath;
          } else {
            stagedCoverImagePath = path.join(stagingRoot, snapshot.coverImageRelativePath);
            const hasCover = await generateBookCover(
              snapshot.book,
              stagedCoverImagePath,
              options.dryRun,
              resolvedPdfRenderBackend,
            );
            if (hasCover) {
              generatedCoverImageCount = options.dryRun ? 0 : 1;
              nextCoverImageRelativePath = snapshot.coverImageRelativePath;
            } else {
              nextCoverImageRelativePath = null;
            }
          }
        }

        if (nextBookFileRelativePath) {
          const coverImagePropertyValue = toObsidianWikilink(config.managedDirName, nextCoverImageRelativePath);
          markdown = renderBookMarkdownForSnapshot(
            snapshot,
            epubNotes,
            epubChapterTitleByKey,
            epubChapterOrderByKey,
            pdfPages,
            coverImagePropertyValue,
            vaultName,
          );
        }

        if (!options.dryRun) {
          const hasRenderableContent = epubNotes.length > 0 || pdfPages.length > 0;
          if (nextBookFileRelativePath && hasRenderableContent) {
            const targetBookPath = path.join(outputDir, nextBookFileRelativePath);
            const existingMarkdown = await readPreviousBookMarkdown(outputDir, nextBookFileRelativePath);
            const mergedMarkdown = mergeBookMarkdownProperties(markdown, existingMarkdown);
            await writeFileAtomically(targetBookPath, mergedMarkdown);
          }

          if (snapshot.book.format === "PDF" && pdfPages.length > 0) {
            const currentPdfAssetDir = path.join(outputDir, path.posix.join("assets", "pdf", snapshot.book.assetId));
            if (nextPdfAssetDirRelativePath && generatedPdfImageCount > 0) {
              const targetPdfAssetDir = path.join(outputDir, nextPdfAssetDirRelativePath);
              await replaceDirectoryAtomically(stagedPdfAssetDir, targetPdfAssetDir);
            } else {
              await removeDirectoryIfExists(currentPdfAssetDir);
            }
          }

          if (nextCoverImageRelativePath && stagedCoverImagePath) {
            const targetCoverImagePath = path.join(outputDir, nextCoverImageRelativePath);
            await fs.mkdir(path.dirname(targetCoverImagePath), { recursive: true });
            await fs.rename(stagedCoverImagePath, targetCoverImagePath);
          } else if (!canPreservePreviousOutput) {
            await removeFileIfExists(path.join(outputDir, "assets", "covers", `${snapshot.book.assetId}.png`));
          }

          if (
            previousAssetState &&
            previousAssetState.bookFileRelativePath &&
            previousAssetState.bookFileRelativePath !== nextBookFileRelativePath
          ) {
            await removeFileIfExists(path.join(outputDir, previousAssetState.bookFileRelativePath));
          }

          if (
            previousAssetState &&
            previousAssetState.pdfAssetDirRelativePath &&
            previousAssetState.pdfAssetDirRelativePath !== nextPdfAssetDirRelativePath
          ) {
            await removeDirectoryIfExists(path.join(outputDir, previousAssetState.pdfAssetDirRelativePath));
          }

          if (
            previousAssetState &&
            previousAssetState.coverImageRelativePath &&
            previousAssetState.coverImageRelativePath !== nextCoverImageRelativePath
          ) {
            await removeFileIfExists(path.join(outputDir, previousAssetState.coverImageRelativePath));
          }
        }

        nextStateAssets[snapshot.book.assetId] = toSyncStateAsset(
          snapshot,
          nextBookFileRelativePath,
          nextPdfAssetDirRelativePath,
          nextCoverImageRelativePath,
          syncStartedAt,
        );
        stats.successBooks += 1;
        if (nextBookFileRelativePath) {
          stats.generatedFiles += 1 + generatedPdfImageCount + generatedCoverImageCount;
        }
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "unknown error";
        errors.push({ title: snapshot.book.title, reason });
        options.onProgress?.({ type: "warning", title: snapshot.book.title, message: reason });
        stats.failedBooks += 1;
        if (!options.dryRun) {
          await removeDirectoryIfExists(path.join(stagingRoot, "assets", "pdf", snapshot.book.assetId));
          await removeFileIfExists(path.join(stagingRoot, "assets", "covers", `${snapshot.book.assetId}.png`));
        }
      }
    }

    if (isFullSync) {
      for (const removedAssetId of removedAssetIds) {
        const previousAsset = previousStateAssets[removedAssetId];
        if (!previousAsset) {
          continue;
        }

        if (!options.dryRun) {
          try {
            if (previousAsset.bookFileRelativePath) {
              await removeFileIfExists(path.join(outputDir, previousAsset.bookFileRelativePath));
            }
            if (previousAsset.pdfAssetDirRelativePath) {
              await removeDirectoryIfExists(path.join(outputDir, previousAsset.pdfAssetDirRelativePath));
            }
            if (previousAsset.coverImageRelativePath) {
              await removeFileIfExists(path.join(outputDir, previousAsset.coverImageRelativePath));
            }
          } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : "unknown error";
            errors.push({ title: previousAsset.title, reason });
            options.onProgress?.({ type: "warning", title: previousAsset.title, message: reason });
            continue;
          }
        }
        delete nextStateAssets[removedAssetId];
      }
    }

    if (options.dryRun) {
      log("info", `dry-run completed: ${stats.successBooks}/${stats.totalBooks} books would be generated.`);
      if (removedAssetIds.length > 0) {
        log("info", `dry-run removals: ${removedAssetIds.length} assets would be removed.`);
      }
      if (errors.length > 0) {
        for (const error of errors) {
          log("warn", `failed to prepare "${error.title}": ${error.reason}`);
        }
      }
      return { stats, outputDir };
    }

    if (isFullSync) {
      const indexedAssetIds = new Set(
        Object.values(nextStateAssets)
          .filter((asset) => asset.bookFileRelativePath)
          .map((asset) => asset.assetId),
      );
      const indexBooks = allBooks.filter((book) => indexedAssetIds.has(book.assetId));
      const indexBookPaths = new Map<string, string | null>();
      for (const [assetId, asset] of Object.entries(nextStateAssets)) {
        indexBookPaths.set(assetId, asset.bookFileRelativePath);
      }
      const indexMarkdown = renderIndexMarkdown(indexBooks, new Date(), booksDirName, indexBookPaths, nextStateAssets);
      await writeFileAtomically(path.join(outputDir, "index.md"), indexMarkdown);
      stats.generatedFiles += 1;
    }

    await writeSyncState(outputDir, nextStateAssets);
  } finally {
    if (!options.dryRun) {
      await removeDirectoryIfExists(stagingRoot);
    }
    if (releaseLock) {
      await releaseLock();
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      log("warn", `book failed: "${error.title}" -> ${error.reason}`);
    }
  }

  options.onProgress?.({
    type: "complete",
    successBooks: stats.successBooks,
    failedBooks: stats.failedBooks,
    skippedBooks: stats.skippedBooks,
    generatedFiles: stats.generatedFiles,
  });

  return { stats, outputDir };
}

export { shouldForcePdfResync };
