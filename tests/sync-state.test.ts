import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireSyncLock,
  buildBookSyncHash,
  getSyncStateDir,
  getSyncStatePath,
  getSyncStateSqlitePath,
  readSyncState,
  writeSyncState,
} from "../src/lib/sync-state";
import type { SyncAssetState } from "../src/lib/types";

test("buildBookSyncHash for EPUB uses annotation modification only", () => {
  const hash = buildBookSyncHash("EPUB", 12345, null);
  assert.equal(hash, "EPUB|mod:12345");
});

test("buildBookSyncHash for PDF uses source file stamp only", () => {
  const hash = buildBookSyncHash("PDF", 789, { mtimeMs: 1000.9, size: 2048 });
  assert.equal(hash, "PDF|file:1000:2048");
});

test("readSyncState returns empty state when file is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-sync-state-"));
  try {
    const state = await readSyncState(tempDir);
    assert.equal(state.version, 1);
    assert.deepEqual(state.assets, {});
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("writeSyncState persists assets", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-sync-state-"));
  try {
    const assets: Record<string, SyncAssetState> = {
      "asset-1": {
        assetId: "asset-1",
        title: "Book 1",
        format: "EPUB",
        hash: "EPUB|mod:10",
        lastSyncedAt: "2026-02-28T00:00:00.000Z",
        bookFileRelativePath: "books/book-1.md",
        chapterNotes: true,
        chapterFileRelativePaths: ["books/book-1/001-intro.md"],
        pdfAssetDirRelativePath: null,
        coverImageRelativePath: "assets/covers/asset-1.png",
      },
    };
    await writeSyncState(tempDir, assets);

    const reloaded = await readSyncState(tempDir);
    assert.equal(await fileExists(getSyncStateSqlitePath(tempDir)), true);
    assert.equal(reloaded.assets["asset-1"]?.hash, "EPUB|mod:10");
    assert.equal(reloaded.assets["asset-1"]?.lastSyncedAt, "2026-02-28T00:00:00.000Z");
    assert.equal(reloaded.assets["asset-1"]?.chapterNotes, true);
    assert.deepEqual(reloaded.assets["asset-1"]?.chapterFileRelativePaths, ["books/book-1/001-intro.md"]);
    assert.equal(reloaded.assets["asset-1"]?.coverImageRelativePath, "assets/covers/asset-1.png");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("readSyncState migrates legacy JSON state when sqlite state is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-sync-state-"));
  try {
    await fs.writeFile(
      getSyncStatePath(tempDir),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-02-28T00:00:00.000Z",
        assets: {
          legacy: {
            assetId: "legacy",
            title: "Legacy",
            format: "EPUB",
            hash: "EPUB|mod:1",
            lastSyncedAt: null,
            bookFileRelativePath: "books/legacy.md",
            pdfAssetDirRelativePath: null,
            coverImageRelativePath: null,
          },
        },
      }),
      "utf8",
    );

    const state = await readSyncState(tempDir);
    assert.equal(state.assets.legacy?.title, "Legacy");
    assert.equal(state.assets.legacy?.chapterNotes, false);
    assert.deepEqual(state.assets.legacy?.chapterFileRelativePaths, []);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("acquireSyncLock removes stale lock when recorded process is gone", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-sync-state-"));
  try {
    const stateDir = getSyncStateDir(tempDir);
    const lockPath = path.join(stateDir, "lock");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(lockPath, "99999999\n2026-06-01T00:00:00.000Z\n", "utf8");

    const release = await acquireSyncLock(tempDir);
    const lock = await fs.readFile(lockPath, "utf8");
    assert.match(lock, new RegExp(`^${process.pid}\\n`));

    await release();
    assert.equal(await fileExists(lockPath), false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("acquireSyncLock rejects lock owned by a live process", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-sync-state-"));
  try {
    const stateDir = getSyncStateDir(tempDir);
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, "lock"), `${process.pid}\n2026-06-01T00:00:00.000Z\n`, "utf8");

    await assert.rejects(() => acquireSyncLock(tempDir), /Another sync process is running \(pid \d+\)/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
