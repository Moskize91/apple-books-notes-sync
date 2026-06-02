import path from "node:path";
import type { Book, EpubAnnotation, PdfOutlineLeaf, SyncAssetState } from "./types";
import { normalizeQuoteText } from "./quote-normalize";
import { BOOK_INTERACTIVE_PROPERTY_DEFAULTS, BOOK_PROPERTY_KEYS } from "./book-properties";
import { OBSIDIAN_OPEN_PDF_ACTION } from "./obsidian-protocol";

type PdfRenderedNote = {
  marker: string | null;
  quoteText: string;
  noteText: string;
  hasRect: boolean;
};

type PdfRenderedPage = {
  pageNumber: number;
  imageRelativePath: string | null;
  notes: PdfRenderedNote[];
};

export type PdfRenderedChapter = {
  title: string;
  pageNumber: number;
  order: number;
  pages: PdfRenderedPage[];
};

export type EpubRenderedChapter = {
  title: string;
  order: number;
  annotations: EpubAnnotation[];
};

export type RenderedMarkdownFile = {
  relativePath: string;
  markdown: string;
};

type FrontmatterDateTime = {
  type: "datetime";
  value: Date;
};
type FrontmatterValue = string | number | boolean | FrontmatterDateTime;
type FrontmatterProperty = [string, FrontmatterValue | null];
const LOCATION_SORT_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function fmtDate(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function fmtObsidianDateTime(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

export function renderIndexMarkdown(
  books: Book[],
  generatedAt: Date,
  booksDirName: string,
  bookFileRelativePathByAssetId?: Map<string, string | null>,
  syncAssetStateByAssetId?: Record<string, SyncAssetState>,
): string {
  const lines: string[] = [];
  const rows = books
    .map((book) => {
      const mapped = bookFileRelativePathByAssetId?.get(book.assetId);
      const fileName = mapped ?? getBookFileRelativePath(book, booksDirName);
      if (!fileName) {
        return null;
      }
      const state = syncAssetStateByAssetId?.[book.assetId];
      const lastSyncedAtEpochMs = state?.lastSyncedAt ? Date.parse(state.lastSyncedAt) : Number.NaN;
      return {
        book,
        fileName,
        lastSyncedAtEpochMs: Number.isFinite(lastSyncedAtEpochMs) ? lastSyncedAtEpochMs : Number.NEGATIVE_INFINITY,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => {
      if (left.lastSyncedAtEpochMs !== right.lastSyncedAtEpochMs) {
        return right.lastSyncedAtEpochMs - left.lastSyncedAtEpochMs;
      }
      const leftStem = path.posix.basename(left.fileName, ".md");
      const rightStem = path.posix.basename(right.fileName, ".md");
      return leftStem.localeCompare(rightStem);
    });

  pushFrontmatter(lines, [
    ["title", "Apple Books Notes Sync Index"],
    ["generated_at", fmtDate(generatedAt)],
    ["book_count", rows.length],
  ]);
  lines.push("| 书名 | 作者 | 格式 |");
  lines.push("| --- | --- | --- |");

  for (const row of rows) {
    const wikiTarget = row.fileName.replace(/\.md$/i, "");
    lines.push(`| [[${wikiTarget}]] | ${escapeCell(row.book.author ?? "-")} | ${row.book.format} |`);
  }

  lines.push("");
  return lines.join("\n");
}

function escapeCell(input: string): string {
  return input.replace(/\|/g, "\\|");
}

function toYamlScalar(value: FrontmatterValue): string {
  if (typeof value === "object") {
    return fmtObsidianDateTime(value.value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function pushFrontmatter(lines: string[], properties: FrontmatterProperty[]): void {
  lines.push("---");
  for (const [key, value] of properties) {
    if (value === null) {
      continue;
    }
    lines.push(`${key}: ${toYamlScalar(value)}`);
  }
  lines.push("---");
  lines.push("");
}

export function renderBookFrontmatterMarkdown(properties: FrontmatterProperty[]): string {
  const lines: string[] = [];
  pushFrontmatter(lines, properties);
  return lines.join("\n");
}

function toDisplayChapterKey(rawChapterKey: string, chapterTitleByKey?: Map<string, string>): string {
  const chapterKey = rawChapterKey.trim();
  if (chapterKey.length === 0) {
    return "未分章";
  }
  const mappedChapterTitle = chapterTitleByKey?.get(chapterKey)?.trim();
  if (mappedChapterTitle) {
    return mappedChapterTitle;
  }
  if (/^id[_-]?\d+$/i.test(chapterKey)) {
    return "未分章";
  }
  // Raw chapter keys like "x_part01.xhtml" are EPUB internal file names, not user-facing chapter labels.
  if (/\.x?html?$/i.test(chapterKey)) {
    return "未分章";
  }
  return chapterKey;
}

function normalizeLocationForSort(location: string | null): string {
  if (!location) {
    return "";
  }
  return location
    .replace(/^epubcfi\(/i, "")
    .replace(/\)$/g, "")
    .replace(/\[[^\]]*]/g, "");
}

function compareEpubAnnotationsBySourceOrder(
  left: EpubAnnotation,
  right: EpubAnnotation,
  chapterOrderByKey?: Map<string, number>,
): number {
  const leftChapterOrder = chapterOrderByKey?.get(left.chapterKey) ?? Number.MAX_SAFE_INTEGER;
  const rightChapterOrder = chapterOrderByKey?.get(right.chapterKey) ?? Number.MAX_SAFE_INTEGER;
  if (leftChapterOrder !== rightChapterOrder) {
    return leftChapterOrder - rightChapterOrder;
  }

  const leftLocation = normalizeLocationForSort(left.location);
  const rightLocation = normalizeLocationForSort(right.location);
  const locationCompare = LOCATION_SORT_COLLATOR.compare(leftLocation, rightLocation);
  if (locationCompare !== 0) {
    return locationCompare;
  }

  if (left.createdAt.getTime() !== right.createdAt.getTime()) {
    return left.createdAt.getTime() - right.createdAt.getTime();
  }
  return left.id.localeCompare(right.id);
}

function trimBlankEdges(input: string): string {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let start = 0;
  while (start < lines.length) {
    const line = lines[start];
    if (line === undefined || line.trim() !== "") {
      break;
    }
    start += 1;
  }

  let end = lines.length;
  while (end > start) {
    const line = lines[end - 1];
    if (line === undefined || line.trim() !== "") {
      break;
    }
    end -= 1;
  }

  if (start >= end) {
    return "";
  }
  return lines.slice(start, end).join("\n");
}

function normalizeNoteText(noteText: string): string {
  const trimmed = trimBlankEdges(noteText);
  if (!trimmed) {
    return "";
  }
  const kept = trimmed.split("\n");
  const lastLine = kept[kept.length - 1];
  if (lastLine === undefined) {
    return "";
  }
  kept[kept.length - 1] = lastLine.replace(/\s+$/g, "");
  return kept.join("\n");
}

function buildEpubLocationLink(book: Book, location: string | null): string {
  if (!location) {
    return `ibooks://assetid/${book.assetId}`;
  }
  return `ibooks://assetid/${book.assetId}#${location}`;
}

function buildEpubOpenUrl(book: Book): string {
  return `ibooks://assetid/${book.assetId}`;
}

function buildMarkdownLink(label: string, url: string): string {
  const escapedLabel = label.replace(/\\/g, "\\\\").replace(/]/g, "\\]").replace(/\s+/g, " ").trim();
  return `[${escapedLabel}](<${url}>)`;
}

function buildWikiLink(targetRelativePath: string, label: string): string {
  const target = targetRelativePath.replace(/\.md$/i, "");
  const escapedLabel = label.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  return `[[${target}|${escapedLabel || target}]]`;
}

function buildPdfOpenUrl(book: Book, vaultName?: string | null, pageNumber?: number): string {
  if (!book.path) {
    return "#";
  }
  const params: Array<[string, string]> = [["pdf", path.isAbsolute(book.path) ? book.path : path.resolve(book.path)]];
  if (pageNumber) {
    params.push(["page", String(pageNumber)]);
  }
  if (vaultName) {
    params.push(["vault", vaultName]);
  }
  const query = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  return `obsidian://${OBSIDIAN_OPEN_PDF_ACTION}?${query}`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getBookFileRelativePath(book: Book, booksDirName: string): string {
  const fileName = `${book.title.replace(/[<>:"/\\|?*]/g, "_")}-${book.assetId.slice(0, 8)}.md`;
  return path.posix.join(booksDirName, fileName);
}

export function renderEpubBookMarkdown(
  book: Book,
  annotations: EpubAnnotation[],
  chapterTitleByKey?: Map<string, string>,
  chapterOrderByKey?: Map<string, number>,
  coverImagePropertyValue?: string | null,
  chapterNotes = false,
): string {
  const lines: string[] = [];
  pushFrontmatter(lines, getEpubBookProperties(book, annotations.length, coverImagePropertyValue, chapterNotes));

  if (annotations.length === 0) {
    lines.push("> 本书暂无可同步的 EPUB 标注。");
    lines.push("");
    return lines.join("\n");
  }

  for (const chapter of buildEpubRenderedChapters(annotations, chapterTitleByKey, chapterOrderByKey)) {
    lines.push(`## ${chapter.title}`);
    lines.push("");
    pushEpubAnnotationBlocks(lines, book, chapter.annotations);
  }

  return lines.join("\n");
}

export function buildEpubRenderedChapters(
  annotations: EpubAnnotation[],
  chapterTitleByKey?: Map<string, string>,
  chapterOrderByKey?: Map<string, number>,
): EpubRenderedChapter[] {
  const sortedAnnotations = [...annotations].sort((left, right) => {
    return compareEpubAnnotationsBySourceOrder(left, right, chapterOrderByKey);
  });

  const chapterMap = new Map<string, { order: number; annotations: EpubAnnotation[] }>();
  for (const annotation of sortedAnnotations) {
    const chapterDisplayKey = toDisplayChapterKey(annotation.chapterKey, chapterTitleByKey);
    const chapterOrder = chapterOrderByKey?.get(annotation.chapterKey) ?? Number.MAX_SAFE_INTEGER;
    const existing = chapterMap.get(chapterDisplayKey);
    if (existing) {
      existing.annotations.push(annotation);
      if (chapterOrder < existing.order) {
        existing.order = chapterOrder;
      }
      continue;
    }
    chapterMap.set(chapterDisplayKey, { order: chapterOrder, annotations: [annotation] });
  }

  return Array.from(chapterMap.entries())
    .map(([title, value]) => {
      return {
        title,
        order: value.order,
        annotations: value.annotations,
      };
    })
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.title.localeCompare(right.title);
    });
}

export function renderEpubChapterIndexMarkdown(
  book: Book,
  chapters: EpubRenderedChapter[],
  chapterFileRelativePaths: string[],
  coverImagePropertyValue?: string | null,
): string {
  const lines: string[] = [];
  const annotationCount = chapters.reduce((total, chapter) => total + chapter.annotations.length, 0);
  pushFrontmatter(lines, getEpubBookProperties(book, annotationCount, coverImagePropertyValue, true));

  if (chapters.length === 0) {
    lines.push("> 本书暂无可同步的 EPUB 标注。");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| 章节 | 标注 |");
  lines.push("| --- | ---: |");
  for (const [index, chapter] of chapters.entries()) {
    const relativePath = chapterFileRelativePaths[index];
    if (!relativePath) {
      continue;
    }
    lines.push(`| ${buildWikiLink(relativePath, chapter.title)} | ${chapter.annotations.length} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderEpubChapterMarkdown(
  book: Book,
  chapter: EpubRenderedChapter,
  chapterIndex: number,
): string {
  const lines: string[] = [];
  const firstAnnotation = chapter.annotations[0];
  pushFrontmatter(lines, [
    [BOOK_PROPERTY_KEYS.title, `${book.title} - ${chapter.title}`],
    ["book_title", book.title],
    [BOOK_PROPERTY_KEYS.author, book.author ?? "-"],
    [BOOK_PROPERTY_KEYS.format, "EPUB"],
    ["chapter", chapter.title],
    ["chapter_index", chapterIndex],
    [BOOK_PROPERTY_KEYS.annotationCount, chapter.annotations.length],
    [BOOK_PROPERTY_KEYS.sourceFile, book.path],
    [
      BOOK_PROPERTY_KEYS.openUrl,
      buildMarkdownLink(chapter.title, buildEpubLocationLink(book, firstAnnotation?.location ?? null)),
    ],
  ]);
  pushEpubAnnotationBlocks(lines, book, chapter.annotations);
  return lines.join("\n");
}

function pushEpubAnnotationBlocks(lines: string[], book: Book, annotations: EpubAnnotation[]): void {
  for (const [index, annotation] of annotations.entries()) {
    if (index === 0) {
      lines.push("---");
    }
    const quoteText = normalizeQuoteText(annotation.selectedText ?? "");
    const timestamp = fmtDate(annotation.createdAt);
    const timestampLabel = `[${timestamp}](<${buildEpubLocationLink(book, annotation.location)}>)`;

    if (quoteText) {
      lines.push(`> ${timestampLabel} ${quoteText}`);
    } else {
      lines.push(`> ${timestampLabel}`);
    }
    lines.push("");

    const normalizedNoteText = normalizeNoteText(annotation.noteText ?? "");
    if (normalizedNoteText) {
      lines.push(normalizedNoteText);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }
}

export function getEpubBookProperties(
  book: Book,
  annotationCount: number,
  coverImagePropertyValue?: string | null,
  chapterNotes = false,
): FrontmatterProperty[] {
  return [
    [BOOK_PROPERTY_KEYS.title, book.title],
    [BOOK_PROPERTY_KEYS.author, book.author ?? "-"],
    [BOOK_PROPERTY_KEYS.publisher, book.publisher],
    [BOOK_PROPERTY_KEYS.format, "EPUB"],
    [BOOK_PROPERTY_KEYS.syncPaused, BOOK_INTERACTIVE_PROPERTY_DEFAULTS.sync_paused],
    [BOOK_PROPERTY_KEYS.chapterNotes, chapterNotes],
    [BOOK_PROPERTY_KEYS.annotationCount, annotationCount],
    [
      BOOK_PROPERTY_KEYS.lastModifiedAt,
      book.annotationModifiedAt ? { type: "datetime", value: book.annotationModifiedAt } : null,
    ],
    [BOOK_PROPERTY_KEYS.cover, coverImagePropertyValue ?? null],
    [BOOK_PROPERTY_KEYS.sourceFile, book.path],
    [BOOK_PROPERTY_KEYS.openUrl, buildMarkdownLink(book.title, buildEpubOpenUrl(book))],
  ];
}

export function renderPdfBookMarkdown(
  book: Book,
  pages: PdfRenderedPage[],
  coverImagePropertyValue?: string | null,
  sourceModifiedAt?: Date | null,
  vaultName?: string | null,
  chapterNotes = false,
): string {
  const lines: string[] = [];
  pushFrontmatter(lines, getPdfBookProperties(book, pages.length, coverImagePropertyValue, sourceModifiedAt, chapterNotes));

  if (pages.length === 0) {
    lines.push("> 本书暂无可同步的 PDF 标注。");
    lines.push("");
    return lines.join("\n");
  }

  for (const page of pages) {
    pushPdfPageBlock(lines, book, page, vaultName, "..");
  }

  return lines.join("\n");
}

export function buildPdfRenderedChapters(
  pages: PdfRenderedPage[],
  outlineLeaves: PdfOutlineLeaf[],
): PdfRenderedChapter[] {
  const sortedLeaves = [...outlineLeaves].sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }
    return left.order - right.order;
  });
  const chapters: PdfRenderedChapter[] = [];
  for (const [index, leaf] of sortedLeaves.entries()) {
    const nextLeaf = sortedLeaves[index + 1];
    const chapterPages = pages.filter((page) => {
      return page.pageNumber >= leaf.pageNumber && (!nextLeaf || page.pageNumber < nextLeaf.pageNumber);
    });
    if (chapterPages.length === 0) {
      continue;
    }
    chapters.push({
      title: leaf.title,
      pageNumber: leaf.pageNumber,
      order: leaf.order,
      pages: chapterPages,
    });
  }
  return chapters;
}

export function renderPdfChapterIndexMarkdown(
  book: Book,
  chapters: PdfRenderedChapter[],
  chapterFileRelativePaths: string[],
  coverImagePropertyValue?: string | null,
  sourceModifiedAt?: Date | null,
): string {
  const lines: string[] = [];
  const annotatedPages = chapters.reduce((total, chapter) => total + chapter.pages.length, 0);
  pushFrontmatter(lines, getPdfBookProperties(book, annotatedPages, coverImagePropertyValue, sourceModifiedAt, true));

  if (chapters.length === 0) {
    lines.push("> 本书暂无可同步的 PDF 标注。");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| 章节 | 页数 | 标注 |");
  lines.push("| --- | ---: | ---: |");
  for (const [index, chapter] of chapters.entries()) {
    const relativePath = chapterFileRelativePaths[index];
    if (!relativePath) {
      continue;
    }
    const noteCount = chapter.pages.reduce((total, page) => total + page.notes.length, 0);
    lines.push(`| ${buildWikiLink(relativePath, chapter.title)} | ${chapter.pages.length} | ${noteCount} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderPdfChapterMarkdown(
  book: Book,
  chapter: PdfRenderedChapter,
  chapterIndex: number,
  sourceModifiedAt?: Date | null,
  vaultName?: string | null,
): string {
  const lines: string[] = [];
  pushFrontmatter(lines, [
    [BOOK_PROPERTY_KEYS.title, `${book.title} - ${chapter.title}`],
    ["book_title", book.title],
    [BOOK_PROPERTY_KEYS.author, book.author ?? "-"],
    [BOOK_PROPERTY_KEYS.format, "PDF"],
    ["chapter", chapter.title],
    ["chapter_index", chapterIndex],
    [BOOK_PROPERTY_KEYS.annotatedPages, chapter.pages.length],
    [BOOK_PROPERTY_KEYS.lastModifiedAt, sourceModifiedAt ? { type: "datetime", value: sourceModifiedAt } : null],
    [BOOK_PROPERTY_KEYS.sourceFile, book.path],
    [BOOK_PROPERTY_KEYS.openUrl, buildMarkdownLink(chapter.title, buildPdfOpenUrl(book, vaultName, chapter.pageNumber))],
  ]);
  for (const page of chapter.pages) {
    pushPdfPageBlock(lines, book, page, vaultName, "../..");
  }
  return lines.join("\n");
}

export function getPdfBookProperties(
  book: Book,
  annotatedPages: number,
  coverImagePropertyValue?: string | null,
  sourceModifiedAt?: Date | null,
  chapterNotes = false,
): FrontmatterProperty[] {
  return [
    [BOOK_PROPERTY_KEYS.title, book.title],
    [BOOK_PROPERTY_KEYS.author, book.author ?? "-"],
    [BOOK_PROPERTY_KEYS.publisher, book.publisher],
    [BOOK_PROPERTY_KEYS.format, "PDF"],
    [BOOK_PROPERTY_KEYS.syncPaused, BOOK_INTERACTIVE_PROPERTY_DEFAULTS.sync_paused],
    [BOOK_PROPERTY_KEYS.chapterNotes, chapterNotes],
    [BOOK_PROPERTY_KEYS.annotatedPages, annotatedPages],
    [BOOK_PROPERTY_KEYS.lastModifiedAt, sourceModifiedAt ? { type: "datetime", value: sourceModifiedAt } : null],
    [BOOK_PROPERTY_KEYS.cover, coverImagePropertyValue ?? null],
    [BOOK_PROPERTY_KEYS.sourceFile, book.path],
    [BOOK_PROPERTY_KEYS.openUrl, buildMarkdownLink(book.title, buildPdfOpenUrl(book))],
  ];
}

function pushPdfNoteBlock(lines: string[], note: PdfRenderedNote, markerLabel: string | null): void {
  const quoteText = normalizeQuoteText(note.quoteText ?? "");
  const normalizedNoteText = normalizeNoteText(note.noteText ?? "");
  if (quoteText) {
    if (markerLabel) {
      lines.push(`> **标注 ${markerLabel}** ${quoteText}`);
    } else {
      lines.push(`> ${quoteText}`);
    }
    lines.push("");
  } else if (markerLabel) {
    const locationTag = note.hasRect ? "" : "（无定位）";
    lines.push(`**标注 ${markerLabel}**${locationTag}`);
    lines.push("");
  }

  if (normalizedNoteText) {
    lines.push(normalizedNoteText.replace(/\n+$/g, ""));
    lines.push("");
  }
}

function pushPdfPageBlock(
  lines: string[],
  book: Book,
  page: PdfRenderedPage,
  vaultName: string | null | undefined,
  imageRelativePrefix: ".." | "../..",
): void {
  if (lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  if (page.imageRelativePath) {
    const pageLinkPath = path.posix.join(imageRelativePrefix, page.imageRelativePath);
    const escapedImagePath = escapeHtmlAttr(pageLinkPath);
    const escapedPageLink = escapeHtmlAttr(buildPdfOpenUrl(book, vaultName, page.pageNumber));
    lines.push(
      `<p align="center"><img src="${escapedImagePath}" alt="第${page.pageNumber}页" /> <a href="${escapedPageLink}">第 ${page.pageNumber} 页</a></p>`,
    );
  } else {
    const escapedPageLink = escapeHtmlAttr(buildPdfOpenUrl(book, vaultName, page.pageNumber));
    lines.push(`<p align="center"><a href="${escapedPageLink}">第 ${page.pageNumber} 页</a></p>`);
  }
  lines.push("");

  if (page.notes.length === 0) {
    lines.push("- 无可展示笔记");
  } else if (page.notes.length === 1) {
    const note = page.notes[0];
    if (note) {
      pushPdfNoteBlock(lines, note, null);
    }
  } else {
    for (const [index, note] of page.notes.entries()) {
      const markerLabel = note.marker ?? String(index + 1);
      pushPdfNoteBlock(lines, note, markerLabel);
      if (index < page.notes.length - 1) {
        lines.push("---");
        lines.push("");
      }
    }
  }

  if (lines[lines.length - 1] !== "") {
    lines.push("");
  }
}

export type { PdfRenderedPage, PdfRenderedNote };
