import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PLUGIN_ID, getPluginDir } from "./plugin-settings";

export type ObsidianVault = {
  id: string;
  name: string;
  path: string;
  open: boolean;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
};

type RawObsidianJson = {
  vaults?: Record<string, { path?: unknown; open?: unknown; ts?: unknown }>;
};

export class VaultResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultResolutionError";
  }
}

function getObsidianConfigDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "obsidian");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Obsidian");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "obsidian");
}

export function getObsidianJsonPath(): string {
  return path.join(getObsidianConfigDir(), "obsidian.json");
}

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

async function readEnabledPluginIds(vaultDir: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(vaultDir, ".obsidian", "community-plugins.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

async function toVault(id: string, vaultPath: string, open: boolean): Promise<ObsidianVault | null> {
  const resolvedPath = path.resolve(vaultPath);
  if (!(await pathExists(path.join(resolvedPath, ".obsidian")))) {
    return null;
  }
  const pluginInstalled = await pathExists(path.join(getPluginDir(resolvedPath), "manifest.json"));
  const enabledPluginIds = await readEnabledPluginIds(resolvedPath);
  return {
    id,
    name: path.basename(resolvedPath),
    path: resolvedPath,
    open,
    pluginInstalled,
    pluginEnabled: enabledPluginIds.has(PLUGIN_ID),
  };
}

export async function discoverObsidianVaults(): Promise<ObsidianVault[]> {
  let parsed: RawObsidianJson;
  try {
    parsed = JSON.parse(await fs.readFile(getObsidianJsonPath(), "utf8")) as RawObsidianJson;
  } catch {
    return [];
  }
  const result: ObsidianVault[] = [];
  for (const [id, value] of Object.entries(parsed.vaults ?? {})) {
    if (typeof value.path !== "string") {
      continue;
    }
    const vault = await toVault(id, value.path, value.open === true);
    if (vault) {
      result.push(vault);
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

async function findContainingVault(cwd: string, vaults: ObsidianVault[]): Promise<ObsidianVault | null> {
  const resolvedCwd = path.resolve(cwd);
  const matches = vaults
    .filter((vault) => {
      const relative = path.relative(vault.path, resolvedCwd);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    })
    .sort((left, right) => right.path.length - left.path.length);
  return matches[0] ?? null;
}

function assertPluginUsable(vault: ObsidianVault): ObsidianVault {
  if (!vault.pluginInstalled) {
    throw new VaultResolutionError(
      `Apple Books Notes Sync plugin is not installed in vault "${vault.name}" (${vault.path}).`,
    );
  }
  if (!vault.pluginEnabled) {
    throw new VaultResolutionError(
      `Apple Books Notes Sync plugin is not enabled in vault "${vault.name}" (${vault.path}).`,
    );
  }
  return vault;
}

function formatVaults(vaults: ObsidianVault[]): string {
  return vaults
    .map((vault) => {
      const status = vault.open ? "open" : "closed";
      const plugin = vault.pluginEnabled ? "enabled" : vault.pluginInstalled ? "installed" : "missing";
      return `  ${vault.name}  ${vault.id}  ${status}  ${plugin}  ${vault.path}`;
    })
    .join("\n");
}

export async function resolveVault(selector?: string, cwd = process.cwd()): Promise<ObsidianVault> {
  const vaults = await discoverObsidianVaults();
  if (selector) {
    const byId = vaults.find((vault) => vault.id === selector);
    if (byId) {
      return assertPluginUsable(byId);
    }

    const byName = vaults.filter((vault) => vault.name === selector);
    if (byName.length === 1) {
      return assertPluginUsable(byName[0]!);
    }
    if (byName.length > 1) {
      throw new VaultResolutionError(`Multiple vaults named "${selector}" were found:\n${formatVaults(byName)}`);
    }

    const absolutePath = path.resolve(selector);
    const byPath = vaults.find((vault) => path.resolve(vault.path) === absolutePath);
    if (byPath) {
      return assertPluginUsable(byPath);
    }
    const direct = await toVault("path", absolutePath, false);
    if (direct) {
      return assertPluginUsable(direct);
    }
    throw new VaultResolutionError(`No Obsidian vault matched selector "${selector}".`);
  }

  const containing = await findContainingVault(cwd, vaults);
  if (containing) {
    return assertPluginUsable(containing);
  }

  const usable = vaults.filter((vault) => vault.pluginInstalled && vault.pluginEnabled);
  if (usable.length === 1) {
    return usable[0]!;
  }

  const openUsable = usable.filter((vault) => vault.open);
  if (openUsable.length === 1) {
    return openUsable[0]!;
  }

  if (usable.length === 0) {
    throw new VaultResolutionError(
      "No Obsidian vault with Apple Books Notes Sync installed and enabled was found.",
    );
  }
  throw new VaultResolutionError(`Multiple usable Obsidian vaults were found:\n${formatVaults(usable)}`);
}
