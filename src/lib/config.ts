import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandHome } from "./path-utils";
import type { CliConfig, PdfRenderBackend } from "./types";

type RawConfig = Partial<Omit<CliConfig, "outputDir"> & { outputDir: string | null }>;

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function getDefaultConfig(): CliConfig {
  return {
    outputDir: null,
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
  const raw = await fs.readFile(getConfigPath(), "utf8");
  const parsed = JSON.parse(raw) as RawConfig;
  return normalizeConfig(parsed);
}

export async function readConfigOrDefault(): Promise<CliConfig> {
  try {
    return await readConfig();
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return getDefaultConfig();
    }
    throw error;
  }
}

export function normalizeConfig(config: RawConfig): CliConfig {
  const defaults = getDefaultConfig();
  return {
    outputDir: normalizeOptionalPath(config.outputDir),
    managedDirName: config.managedDirName ?? defaults.managedDirName,
    pdfBetaEnabled: config.pdfBetaEnabled ?? defaults.pdfBetaEnabled,
    pdfRenderBackend: parsePdfRenderBackend(config.pdfRenderBackend, defaults.pdfRenderBackend),
  };
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(getConfigPath(), `${JSON.stringify(toStoredConfig(config), null, 2)}\n`, "utf8");
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

export async function loadValidatedConfig(): Promise<CliConfig> {
  try {
    const config = await readConfig();
    await validateConfig(config);
    return config;
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      throw new ConfigValidationError(formatMissingOutputDirError());
    }
    if (error instanceof SyntaxError) {
      throw new ConfigValidationError(formatInvalidJsonError(error.message));
    }
    throw error;
  }
}

export async function validateConfig(config: CliConfig): Promise<void> {
  if (!config.outputDir) {
    throw new ConfigValidationError(formatMissingOutputDirError());
  }

  if (config.managedDirName.trim().length === 0) {
    throw new ConfigValidationError(
      [
        "Invalid config: output.managedDirName cannot be empty",
        "",
        "Fix it with:",
        "",
        '  absync config set output.managedDirName "Apple Books Notes"',
      ].join("\n"),
    );
  }

  const outputDir = path.resolve(config.outputDir);
  let outputStat;
  try {
    outputStat = await fs.stat(outputDir);
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      throw new ConfigValidationError(
        [
          "Invalid config: output.dir does not exist",
          "",
          "Current value:",
          `  ${outputDir}`,
          "",
          "Fix it by setting output.dir to an existing Obsidian vault folder:",
          "",
          '  absync config set output.dir "/path/to/your/ObsidianVault"',
        ].join("\n"),
      );
    }
    throw error;
  }

  if (!outputStat.isDirectory()) {
    throw new ConfigValidationError(
      [
        "Invalid config: output.dir is not a directory",
        "",
        "Current value:",
        `  ${outputDir}`,
        "",
        "Set it to your Obsidian vault folder:",
        "",
        '  absync config set output.dir "/path/to/your/ObsidianVault"',
      ].join("\n"),
    );
  }

  const obsidianConfigDir = path.join(outputDir, ".obsidian");
  try {
    const obsidianStat = await fs.stat(obsidianConfigDir);
    if (!obsidianStat.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new ConfigValidationError(
      [
        "Invalid config: output.dir is not an Obsidian vault",
        "",
        "Expected this folder to contain:",
        "  .obsidian/",
        "",
        "Current value:",
        `  ${outputDir}`,
        "",
        "Open or create a vault in Obsidian, then set the vault folder:",
        "",
        '  absync config set output.dir "/path/to/your/ObsidianVault"',
      ].join("\n"),
    );
  }

  const managedOutputDir = path.join(outputDir, config.managedDirName);
  const managedParentDir = path.dirname(managedOutputDir);
  try {
    await fs.access(managedParentDir, fs.constants.W_OK);
  } catch {
    throw new ConfigValidationError(
      [
        "Invalid output target: cannot write to managed directory",
        "",
        "Target:",
        `  ${managedOutputDir}`,
        "",
        "Check folder permissions, or choose another vault:",
        "",
        '  absync config set output.dir "/path/to/your/ObsidianVault"',
      ].join("\n"),
    );
  }
}

export async function validateConfigValue(key: string, config: CliConfig): Promise<void> {
  if (key === "output.dir") {
    await validateConfig(config);
  }
}

function normalizeOptionalPath(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return expandHome(trimmed);
}

function toStoredConfig(config: CliConfig): Record<string, string | boolean> {
  const stored: Record<string, string | boolean> = {
    managedDirName: config.managedDirName,
    pdfBetaEnabled: config.pdfBetaEnabled,
    pdfRenderBackend: config.pdfRenderBackend,
  };
  if (config.outputDir) {
    stored.outputDir = config.outputDir;
  }
  return stored;
}

function formatMissingOutputDirError(): string {
  return [
    "Missing required config: output.dir",
    "",
    "Set it to your Obsidian vault folder:",
    "",
    '  absync config set output.dir "/path/to/your/ObsidianVault"',
    "",
    "The folder should be an existing Obsidian vault and contain a .obsidian directory.",
  ].join("\n");
}

function formatInvalidJsonError(reason: string): string {
  return [
    "Invalid config file: JSON could not be parsed",
    "",
    "Config file:",
    `  ${getConfigPath()}`,
    "",
    "Parser error:",
    `  ${reason}`,
    "",
    "Fix it with:",
    "",
    "  absync config edit",
  ].join("\n");
}

function getConfigDir(): string {
  return path.join(os.homedir(), "Library", "Application Support", "apple-books-notes-sync");
}
