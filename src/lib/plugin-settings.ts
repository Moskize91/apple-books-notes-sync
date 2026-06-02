import fs from "node:fs/promises";
import path from "node:path";
import { parsePdfPageLinkTarget, parsePdfRenderBackend } from "./config";
import { PLUGIN_ID } from "./obsidian-protocol";
import type { PdfPageLinkTarget, PdfRenderBackend, SyncConfig } from "./types";

export { PLUGIN_ID };
export const DEFAULT_MANAGED_DIR_NAME = "Apple Books Notes";

export type PluginSettings = {
  managedDirName: string;
  syncPdfNotes: boolean;
  pdfRenderBackend: PdfRenderBackend;
  pdfPageLinkTarget: PdfPageLinkTarget;
  absyncPath?: string;
};

type RawPluginSettings = Partial<PluginSettings> & {
  pdfBetaEnabled?: boolean;
};

export function getDefaultPluginSettings(): PluginSettings {
  return {
    managedDirName: DEFAULT_MANAGED_DIR_NAME,
    syncPdfNotes: true,
    pdfRenderBackend: "auto",
    pdfPageLinkTarget: "edge",
  };
}

export function normalizePluginSettings(raw: RawPluginSettings | null | undefined): PluginSettings {
  const defaults = getDefaultPluginSettings();
  const managedDirName =
    typeof raw?.managedDirName === "string" && raw.managedDirName.trim().length > 0
      ? raw.managedDirName
      : defaults.managedDirName;

  const absyncPath =
    typeof raw?.absyncPath === "string" && raw.absyncPath.trim().length > 0
      ? raw.absyncPath.trim()
      : undefined;

  return {
    managedDirName,
    syncPdfNotes: raw?.syncPdfNotes ?? raw?.pdfBetaEnabled ?? defaults.syncPdfNotes,
    pdfRenderBackend: parsePdfRenderBackend(raw?.pdfRenderBackend, defaults.pdfRenderBackend),
    pdfPageLinkTarget: parsePdfPageLinkTarget(raw?.pdfPageLinkTarget, defaults.pdfPageLinkTarget),
    ...(absyncPath ? { absyncPath } : {}),
  };
}

export function pluginSettingsToSyncConfig(vaultDir: string, settings: PluginSettings): SyncConfig {
  return {
    vaultDir: path.resolve(vaultDir),
    managedDirName: settings.managedDirName,
    syncPdfNotes: settings.syncPdfNotes,
    pdfRenderBackend: settings.pdfRenderBackend,
    pdfPageLinkTarget: settings.pdfPageLinkTarget,
  };
}

export function getPluginDir(vaultDir: string): string {
  return path.join(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
}

export function getPluginDataPath(vaultDir: string): string {
  return path.join(getPluginDir(vaultDir), "data.json");
}

export async function readPluginSettings(vaultDir: string): Promise<PluginSettings> {
  try {
    const raw = await fs.readFile(getPluginDataPath(vaultDir), "utf8");
    return normalizePluginSettings(JSON.parse(raw) as RawPluginSettings);
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return getDefaultPluginSettings();
    }
    if (error instanceof SyntaxError) {
      const wrapped = new Error(`Invalid plugin settings JSON: ${getPluginDataPath(vaultDir)}`);
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
    throw error;
  }
}

export async function readSyncConfigFromVault(vaultDir: string): Promise<SyncConfig> {
  return pluginSettingsToSyncConfig(vaultDir, await readPluginSettings(vaultDir));
}
