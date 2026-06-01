import fs from "node:fs/promises";
import path from "node:path";
import { parsePdfRenderBackend } from "./config";
import type { PdfRenderBackend, SyncConfig } from "./types";

export const PLUGIN_ID = "apple-books-notes-sync";
export const DEFAULT_MANAGED_DIR_NAME = "Apple Books Notes";

export type PluginSettings = {
  managedDirName: string;
  pdfBetaEnabled: boolean;
  pdfRenderBackend: PdfRenderBackend;
};

type RawPluginSettings = Partial<PluginSettings>;

export function getDefaultPluginSettings(): PluginSettings {
  return {
    managedDirName: DEFAULT_MANAGED_DIR_NAME,
    pdfBetaEnabled: true,
    pdfRenderBackend: "auto",
  };
}

export function normalizePluginSettings(raw: RawPluginSettings | null | undefined): PluginSettings {
  const defaults = getDefaultPluginSettings();
  const managedDirName =
    typeof raw?.managedDirName === "string" && raw.managedDirName.trim().length > 0
      ? raw.managedDirName
      : defaults.managedDirName;

  return {
    managedDirName,
    pdfBetaEnabled: raw?.pdfBetaEnabled ?? defaults.pdfBetaEnabled,
    pdfRenderBackend: parsePdfRenderBackend(raw?.pdfRenderBackend, defaults.pdfRenderBackend),
  };
}

export function pluginSettingsToSyncConfig(vaultDir: string, settings: PluginSettings): SyncConfig {
  return {
    vaultDir: path.resolve(vaultDir),
    managedDirName: settings.managedDirName,
    pdfBetaEnabled: settings.pdfBetaEnabled,
    pdfRenderBackend: settings.pdfRenderBackend,
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
