import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { SyncAssetState, SyncState, SyncableBookFormat } from "./types";
import { BOOK_PROPERTY_KEYS, normalizeBookInteractiveProperties } from "./book-properties";

const STATE_FILE_NAME = ".sync-state.json";
const STATE_DIR_NAME = ".absync";
const SQLITE_STATE_FILE_NAME = "state.sqlite";
const LOCK_FILE_NAME = "lock";
const LOCK_ACQUIRE_ATTEMPTS = 2;

type PdfFileStamp = {
  mtimeMs: number;
  size: number;
};

function createEmptyState(): SyncState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    assets: {},
  };
}

function asSyncableFormat(value: unknown): SyncableBookFormat | null {
  if (value === "EPUB" || value === "PDF") {
    return value;
  }
  return null;
}

function normalizeStateAsset(assetId: string, value: unknown): SyncAssetState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SyncAssetState> & { chapterNotes?: unknown };
  const format = asSyncableFormat(candidate.format);
  if (!format) {
    return null;
  }

  if (
    typeof candidate.hash !== "string" ||
    typeof candidate.title !== "string" ||
    (typeof candidate.bookFileRelativePath !== "string" && candidate.bookFileRelativePath !== null)
  ) {
    return null;
  }

  const pdfAssetDirRelativePath =
    typeof candidate.pdfAssetDirRelativePath === "string" ? candidate.pdfAssetDirRelativePath : null;
  const coverImageRelativePath =
    typeof candidate.coverImageRelativePath === "string" ? candidate.coverImageRelativePath : null;
  const lastSyncedAt = typeof candidate.lastSyncedAt === "string" ? candidate.lastSyncedAt : null;
  const rawInteractiveProperties =
    candidate.interactiveProperties && typeof candidate.interactiveProperties === "object"
      ? candidate.interactiveProperties
      : {};
  const interactiveProperties = normalizeBookInteractiveProperties({
    ...rawInteractiveProperties,
    ...(typeof candidate.chapterNotes === "boolean" &&
    !(BOOK_PROPERTY_KEYS.chapterNotes in rawInteractiveProperties)
      ? { [BOOK_PROPERTY_KEYS.chapterNotes]: candidate.chapterNotes }
      : {}),
  });
  const chapterFileRelativePaths = Array.isArray(candidate.chapterFileRelativePaths)
    ? candidate.chapterFileRelativePaths.filter((item): item is string => typeof item === "string")
    : [];

  return {
    assetId,
    title: candidate.title,
    format,
    hash: candidate.hash,
    lastSyncedAt,
    bookFileRelativePath: candidate.bookFileRelativePath ?? null,
    chapterFileRelativePaths,
    interactiveProperties,
    pdfAssetDirRelativePath,
    coverImageRelativePath,
  };
}

export function getSyncStatePath(outputDir: string): string {
  return path.join(outputDir, STATE_FILE_NAME);
}

export function getSyncStateDir(outputDir: string): string {
  return path.join(outputDir, STATE_DIR_NAME);
}

export function getSyncStateSqlitePath(outputDir: string): string {
  return path.join(getSyncStateDir(outputDir), SQLITE_STATE_FILE_NAME);
}

function quoteSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function runStateSqlite(dbPath: string, sql: string): string {
  return execFileSync("sqlite3", [dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseSyncState(raw: string): SyncState {
  const parsed = JSON.parse(raw) as Partial<SyncState>;
  if (!parsed || typeof parsed !== "object") {
    return createEmptyState();
  }

  const assets: Record<string, SyncAssetState> = {};
  const rawAssets = parsed.assets;
  if (rawAssets && typeof rawAssets === "object") {
    for (const [assetId, value] of Object.entries(rawAssets)) {
      const normalized = normalizeStateAsset(assetId, value);
      if (normalized) {
        assets[assetId] = normalized;
      }
    }
  }

  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    assets,
  };
}

async function readLegacyJsonSyncState(outputDir: string): Promise<SyncState | null> {
  try {
    return parseSyncState(await fs.readFile(getSyncStatePath(outputDir), "utf8"));
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function readSyncState(outputDir: string): Promise<SyncState> {
  const sqlitePath = getSyncStateSqlitePath(outputDir);
  try {
    await fs.mkdir(getSyncStateDir(outputDir), { recursive: true });
    const output = runStateSqlite(
      sqlitePath,
      "CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL); SELECT value FROM sync_state WHERE key = 'state';",
    ).trim();
    if (output.length > 0) {
      return parseSyncState(output);
    }
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code !== "ENOENT") {
      const legacy = await readLegacyJsonSyncState(outputDir);
      return legacy ?? createEmptyState();
    }
  }

  const legacy = await readLegacyJsonSyncState(outputDir);
  return legacy ?? createEmptyState();
}

export async function writeSyncState(outputDir: string, assets: Record<string, SyncAssetState>): Promise<void> {
  const sqlitePath = getSyncStateSqlitePath(outputDir);
  const state: SyncState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    assets,
  };

  await fs.mkdir(getSyncStateDir(outputDir), { recursive: true });
  const json = JSON.stringify(state);
  runStateSqlite(
    sqlitePath,
    [
      "CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
      `INSERT INTO sync_state (key, value) VALUES ('state', '${quoteSqlString(json)}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    ].join(" "),
  );
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ESRCH") {
      return false;
    }
    if (nodeError?.code === "EPERM") {
      return true;
    }
    return true;
  }
}

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const firstLine = raw.split(/\r?\n/, 1)[0];
    const pid = Number(firstLine);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function removeLockIfStale(lockPath: string): Promise<boolean> {
  const pid = await readLockPid(lockPath);
  if (pid !== null && isProcessAlive(pid)) {
    return false;
  }
  await fs.rm(lockPath, { force: true });
  return true;
}

export async function acquireSyncLock(outputDir: string): Promise<() => Promise<void>> {
  await fs.mkdir(getSyncStateDir(outputDir), { recursive: true });
  const lockPath = path.join(getSyncStateDir(outputDir), LOCK_FILE_NAME);

  let handle;
  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      break;
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code === "EEXIST") {
        if (await removeLockIfStale(lockPath)) {
          continue;
        }
        const pid = await readLockPid(lockPath);
        const detail = pid === null ? "" : ` (pid ${pid})`;
        const wrapped = new Error(`Another sync process is running${detail}. Remove .absync/lock if no sync is active.`);
        (wrapped as Error & { cause?: unknown }).cause = error;
        throw wrapped;
      }
      throw error;
    }
  }

  if (!handle) {
    throw new Error("Failed to acquire sync lock.");
  }

  await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    await handle.close();
    await fs.rm(lockPath, { force: true });
  };
}

function toHashNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "null";
  }
  return String(value);
}

function toPdfStamp(stamp: PdfFileStamp | "missing" | null): string {
  if (stamp === "missing") {
    return "missing";
  }
  if (stamp === null) {
    return "null";
  }
  return `${Math.trunc(stamp.mtimeMs)}:${stamp.size}`;
}

export function buildBookSyncHash(
  format: SyncableBookFormat,
  annotationMaxModificationDate: number | null,
  pdfFileStamp: PdfFileStamp | "missing" | null,
): string {
  if (format === "PDF") {
    return `${format}|file:${toPdfStamp(pdfFileStamp)}`;
  }
  return `${format}|mod:${toHashNumber(annotationMaxModificationDate)}`;
}
