import test from "node:test";
import assert from "node:assert/strict";
import { getSyncPlanRegenerateReason, shouldForcePdfResync } from "../src/lib/sync";
import type { SyncAssetState } from "../src/lib/types";

function buildAsset(assetId: string): SyncAssetState {
  return {
    assetId,
    title: assetId,
    format: "PDF",
    hash: "PDF|mod:1|file:1:1|schema:30",
    lastSyncedAt: "2026-02-28T00:00:00.000Z",
    bookFileRelativePath: `books/${assetId}.md`,
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
    pdfAssetDirRelativePath: null,
    coverImageRelativePath: null,
  };

  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-1.md" },
      undefined,
    ),
    "new",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "PDF", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-1.md" },
      previous,
    ),
    "format-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:2|schema:31", bookFileRelativePath: "books/book-1.md" },
      previous,
    ),
    "content-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-renamed.md" },
      previous,
    ),
    "output-path-changed",
  );
  assert.equal(
    getSyncPlanRegenerateReason(
      { format: "EPUB", hash: "EPUB|mod:1|schema:31", bookFileRelativePath: "books/book-1.md" },
      previous,
    ),
    null,
  );
});
