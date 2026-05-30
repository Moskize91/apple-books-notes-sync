import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  readAnnotationMaxModificationDates,
  readBooks,
  readEpubRenderableCounts,
  readEpubAnnotations,
  readPdfFallbackCounts,
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
  renderEpubBookMarkdown,
  renderIndexMarkdown,
  renderPdfBookMarkdown,
} from "./render-markdown";
import { acquireSyncLock, buildBookSyncHash, readSyncState, writeSyncState } from "./sync-state";
import type {
  Book,
  CliConfig,
  EpubAnnotation,
  IBooksPaths,
  PdfRenderBackend,
  SyncAssetState,
  SyncStats,
  SyncableBookFormat,
} from "./types";

type SyncOptions = {
  dryRun: boolean;
  bookFilter?: string;
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
};

type BookFingerprint = {
  book: Book & { format: SyncableBookFormat };
  hash: string;
  shouldHaveOutput: boolean;
};

export type SyncPlanReason =
  | "new"
  | "unchanged"
  | "format-changed"
  | "content-changed"
  | "output-path-changed"
  | "legacy-output"
  | "missing-output"
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
  annotationCount: number;
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
const OUTPUT_SCHEMA_VERSION = 35;
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

async function hasMissingExpectedCoverImage(outputDir: string, previous: SyncAssetState | undefined): Promise<boolean> {
  if (!previous?.coverImageRelativePath) {
    return false;
  }
  return !(await pathExists(path.join(outputDir, previous.coverImageRelativePath)));
}

async function hasMissingSnapshotCoverImage(outputDir: string, snapshot: BookSyncSnapshot): Promise<boolean> {
  if (!snapshot.bookFileRelativePath || !snapshot.coverImageRelativePath) {
    return false;
  }
  return !(await pathExists(path.join(outputDir, snapshot.coverImageRelativePath)));
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

async function writeCoverPngFromBuffer(input: Buffer, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(input)
    .resize({
      width: COVER_IMAGE_MAX_DIMENSION,
      height: COVER_IMAGE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toFile(outputPath);
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
      await writeCoverPngFromBuffer(coverBuffer, coverImageAbsolutePath);
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
  annotationMaxModificationDates: Map<string, number | null>,
  epubRenderableCounts: Map<string, number>,
  pdfFallbackCounts: Map<string, number>,
  previousStateAssets: Record<string, SyncAssetState>,
): Promise<BookFingerprint> {
  const previous = previousStateAssets[book.assetId];
  const sourceAvailable = await isBookSourceAvailable(book);
  if (!sourceAvailable) {
    const unavailableHash =
      previous?.hash ??
      `${buildBookSyncHash(book.format, annotationMaxModificationDates.get(book.assetId) ?? null, "missing")}|schema:${OUTPUT_SCHEMA_VERSION}`;
    return {
      book,
      hash: unavailableHash,
      shouldHaveOutput: Boolean(previous?.bookFileRelativePath),
    };
  }

  const pdfFileStamp = book.format === "PDF" ? await getPdfFileStamp(book.path) : null;
  const baseHash = buildBookSyncHash(book.format, annotationMaxModificationDates.get(book.assetId) ?? null, pdfFileStamp);
  const hash = `${baseHash}|schema:${OUTPUT_SCHEMA_VERSION}`;
  const shouldHaveOutput =
    book.format === "EPUB"
      ? (epubRenderableCounts.get(book.assetId) ?? 0) > 0 ||
        Boolean(previousStateAssets[book.assetId]?.bookFileRelativePath)
      : (() => {
          if (previous && previous.hash === hash) {
            return previous.bookFileRelativePath !== null;
          }
          return (pdfFallbackCounts.get(book.assetId) ?? 0) > 0 || Boolean(previous?.bookFileRelativePath);
        })();

  return {
    book,
    hash,
    shouldHaveOutput,
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
  config: CliConfig,
  paths: IBooksPaths,
  options: { bookFilter?: string | undefined },
): Promise<SyncPlan> {
  if (!config.outputDir) {
    throw new Error("Missing required config: output.dir");
  }

  const allBooks = readBooks(paths.libraryDbPath, paths.annotationDbPath, paths.epubInfoDbPath).filter(isSyncableBook);
  const books = filterBooks(allBooks, options.bookFilter);
  const isFullSync = !options.bookFilter;

  const outputDir = path.resolve(config.outputDir, config.managedDirName);
  const booksDirName = "books";
  const previousState = await readSyncState(outputDir);
  const nextStateAssets: Record<string, SyncAssetState> = { ...previousState.assets };
  for (const asset of Object.values(nextStateAssets)) {
    if (!asset.lastSyncedAt && previousState.updatedAt && previousState.updatedAt !== new Date(0).toISOString()) {
      asset.lastSyncedAt = previousState.updatedAt;
    }
  }

  const annotationMaxModificationDates = readAnnotationMaxModificationDates(
    paths.annotationDbPath,
    paths.libraryDbPath,
  );
  const epubRenderableCounts = readEpubRenderableCounts(paths.annotationDbPath, paths.libraryDbPath);
  const pdfFallbackCounts = readPdfFallbackCounts(paths.annotationDbPath, paths.libraryDbPath);
  const allBookFingerprints = await Promise.all(
    allBooks.map((book) => {
      return buildBookFingerprint(
        book,
        annotationMaxModificationDates,
        epubRenderableCounts,
        pdfFallbackCounts,
        previousState.assets,
      );
    }),
  );
  const fingerprintByAssetId = new Map<string, BookFingerprint>();
  const hasOutputByAssetId = new Map<string, boolean>();
  for (const fingerprint of allBookFingerprints) {
    fingerprintByAssetId.set(fingerprint.book.assetId, fingerprint);
    hasOutputByAssetId.set(fingerprint.book.assetId, fingerprint.shouldHaveOutput);
  }
  const bookFileRelativePathByAssetId = buildBookFileRelativePathByAssetId(
    allBooks,
    hasOutputByAssetId,
    booksDirName,
  );

  const bookSnapshots: BookSyncSnapshot[] = books.map((book) => {
    const fingerprint = fingerprintByAssetId.get(book.assetId);
    const hash =
      fingerprint?.hash ??
      `${buildBookSyncHash(book.format, annotationMaxModificationDates.get(book.assetId) ?? null, null)}|schema:${OUTPUT_SCHEMA_VERSION}`;
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
    };
  });

  for (const snapshot of bookSnapshots) {
    const existing = nextStateAssets[snapshot.book.assetId];
    if (!existing) {
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
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, regenerateReason));
      continue;
    }

    if (snapshot.book.format === "PDF" && (await hasLegacyPdfFallbackMarker(outputDir, previous))) {
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "legacy-output"));
      continue;
    }

    if (snapshot.book.format === "EPUB" && (await hasLegacyEpubInternalChapterHeading(outputDir, previous))) {
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "legacy-output"));
      continue;
    }

    if (await hasMissingExpectedBookFile(outputDir, previous)) {
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "missing-output"));
      continue;
    }

    if (
      (await hasMissingExpectedCoverImage(outputDir, previous)) ||
      (await hasMissingSnapshotCoverImage(outputDir, snapshot))
    ) {
      changedSnapshots.push(snapshot);
      changed.push(toPlanBook(snapshot, "cover-assets-missing"));
      continue;
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

export async function runSync(config: CliConfig, paths: IBooksPaths, options: SyncOptions): Promise<SyncResult> {
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
  const shouldResolvePdfRenderer = config.pdfBetaEnabled && !options.dryRun && hasChangedPdfSnapshots;
  const resolvedPdfRenderBackend: PdfRenderBackend = shouldResolvePdfRenderer
    ? resolvePdfRenderBackend(config.pdfRenderBackend)
    : "auto";
  if (config.pdfBetaEnabled) {
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
          if (config.pdfBetaEnabled && snapshot.book.path) {
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
            nextBookFileRelativePath = canPreservePreviousOutput
              ? previousAssetState?.bookFileRelativePath ?? null
              : null;
            nextPdfAssetDirRelativePath = canPreservePreviousOutput
              ? previousAssetState?.pdfAssetDirRelativePath ?? null
              : null;
            nextCoverImageRelativePath = canPreservePreviousOutput
              ? previousAssetState?.coverImageRelativePath ?? null
              : null;
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
          markdown =
            snapshot.book.format === "EPUB"
              ? renderEpubBookMarkdown(
                  snapshot.book,
                  epubNotes,
                  epubChapterTitleByKey,
                  epubChapterOrderByKey,
                  coverImagePropertyValue,
                )
              : renderPdfBookMarkdown(snapshot.book, pdfPages, coverImagePropertyValue);
        }

        if (!options.dryRun) {
          const hasRenderableContent = epubNotes.length > 0 || pdfPages.length > 0;
          if (nextBookFileRelativePath && hasRenderableContent) {
            const targetBookPath = path.join(outputDir, nextBookFileRelativePath);
            await writeFileAtomically(targetBookPath, markdown);
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

  return { stats, outputDir };
}

export { shouldForcePdfResync };
