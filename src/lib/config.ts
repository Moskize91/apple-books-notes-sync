import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandHome } from "./path-utils";
import type { CliConfig, PdfRenderBackend } from "./types";

const CONFIG_DIR = path.join(os.homedir(), "Library", "Application Support", "apple-books-notes-sync");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".config", "ibooks-notes-sync", "config.json");

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getLegacyConfigPath(): string {
  return LEGACY_CONFIG_PATH;
}

export function getDefaultConfig(): CliConfig {
  return {
    outputDir: path.join(os.homedir(), "Documents"),
    managedDirName: "Apple Books Notes",
    pdfBetaEnabled: true,
    pdfRenderBackend: "auto",
  };
}

export function isPdfRenderBackend(value: unknown): value is PdfRenderBackend {
  return value === "auto" || value === "swift" || value === "mutool" || value === "poppler";
}

export function parsePdfRenderBackend(value: unknown, fallback: PdfRenderBackend = "auto"): PdfRenderBackend {
  if (isPdfRenderBackend(value)) {
    return value;
  }
  return fallback;
}

export async function readConfig(): Promise<CliConfig> {
  await migrateLegacyConfigIfNeeded();
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<CliConfig>;
  const defaults = getDefaultConfig();

  return {
    outputDir: expandHome(parsed.outputDir ?? defaults.outputDir),
    managedDirName: parsed.managedDirName ?? defaults.managedDirName,
    pdfBetaEnabled: parsed.pdfBetaEnabled ?? defaults.pdfBetaEnabled,
    pdfRenderBackend: parsePdfRenderBackend(parsed.pdfRenderBackend, defaults.pdfRenderBackend),
  };
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function configExists(): Promise<boolean> {
  await migrateLegacyConfigIfNeeded();
  try {
    await fs.access(CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function migrateLegacyConfigIfNeeded(): Promise<boolean> {
  try {
    await fs.access(CONFIG_PATH);
    return false;
  } catch {
    // Continue and check the legacy path.
  }

  try {
    const legacyRaw = await fs.readFile(LEGACY_CONFIG_PATH, "utf8");
    JSON.parse(legacyRaw);
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.copyFile(LEGACY_CONFIG_PATH, CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}
