import test from "node:test";
import assert from "node:assert/strict";
import { getSyncPlanRegenerateReason, hasRenderablePdfPageAnnotations, shouldForcePdfResync } from "../src/lib/sync";
import type { PdfPageAnnotations, SyncAssetState } from "../src/lib/types";

function buildAsset(assetId: string): SyncAssetState {
  return {
    assetId,
    title: assetId,
    format: "PDF",
    hash: "PDF|file:1:1|schema:30",
    lastSyncedAt: "2026-02-28T00:00:00.000Z",
    bookFileRelativePath: `books/${assetId}.md`,
    chapterNotes: false,
    chapterFileRelativePaths: [],
    pdfAssetDirRelativePath: `assets/pdf/${assetId}`,
    coverImageRelativePath: `assets/covers/${assetId}.png`,
  };
}

test("shouldForcePdfResync returns true when prior state exists and assets root is missing", () => {
  const assets: Record<string, SyncAssetState> = {
    "asset-1": buildAsset("asset-1"),
  };
  assert.equal(shouldForcePdfResync(assets, false), true);
});

test("shouldForcePdfResync returns false when assets root exists", () => {
  const assets: Record<string, SyncAssetState> = {
    "asset-1": buildAsset("asset-1"),
  };
  assert.equal(shouldForcePdfResync(assets, true), false);
});

test("shouldForcePdfResync returns false when there is no prior sync state", () => {
  assert.equal(shouldForcePdfResync({}, false), false);
});

test("getSyncPlanRegenerateReason explains why an asset needs sync", () => {
  const previous: SyncAssetState = {
    assetId: "asset-1",
    title: "Book 1",
    format: "EPUB",
    hash: "EPUB|mod:1|schema:31",
    lastSyncedAt: "2026-02-28T00:00:00.000Z",
    bookFileRelativePath: "books/book-1.md",
    chapterNotes: false,
    chapterFileRelativePaths: [],
    pdfAssetDirRelativePath: null,
    coverImageRelativePath: null,
  };

  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-1.md", chapterNotes: false },
      undefined,
    ),
    "new",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "PDF", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-1.md", chapterNotes: false },
      previous,
    ),
    "format-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:2|schema:31", bookFileRelativePath: "books/book-1.md", chapterNotes: false },
      previous,
    ),
    "content-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-renamed.md", chapterNotes: false },
      previous,
    ),
    "output-path-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-1.md", chapterNotes: true },
      previous,
    ),
    "properties-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-1.md", chapterNotes: false },
      previous,
    ),
    null,
  );
});

test("hasRenderablePdfPageAnnotations detects PDF annotations with note content", () => {
  const pages: PdfPageAnnotations[] = [
    {
      pageNumber: 1,
      pageWidth: 100,
      pageHeight: 100,
      annotations: [
        {
          id: "empty",
          pageNumber: 1,
          subtype: "Popup",
          contents: null,
          selectedText: null,
          rect: null,
        },
        {
          id: "note",
          pageNumber: 1,
          subtype: "Text",
          contents: "A note",
          selectedText: null,
          rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
        },
      ],
    },
  ];

  assert.equal(hasRenderablePdfPageAnnotations(pages), true);
});

test("hasRenderablePdfPageAnnotations ignores non-renderable PDF annotations", () => {
  const pages: PdfPageAnnotations[] = [
    {
      pageNumber: 1,
      pageWidth: 100,
      pageHeight: 100,
      annotations: [
        {
          id: "sound",
          pageNumber: 1,
          subtype: "Sound",
          contents: "Audio note",
          selectedText: null,
          rect: { x1: 10, y1: 10, x2: 20, y2: 20 },
        },
      ],
    },
  ];

  assert.equal(hasRenderablePdfPageAnnotations(pages), false);
});
