import { resolveIbooksPaths } from "../lib/ibooks-paths";
import { readSyncConfigFromVault } from "../lib/plugin-settings";
import { applyRuntimeCommands } from "../lib/runtime-config";
import { resolveVault } from "../lib/vault";
import type { IBooksPaths, SyncConfig } from "../lib/types";
import type { ObsidianVault } from "../lib/vault";

export type VaultCommandOptions = {
  vault?: string;
};

export type CommandContext = {
  vault: ObsidianVault;
  config: SyncConfig;
  paths: IBooksPaths;
};

export async function loadCommandContext(options: VaultCommandOptions): Promise<CommandContext> {
  const vault = await resolveVault(options.vault);
  const config = await readSyncConfigFromVault(vault.path);
  applyRuntimeCommands(config);
  const paths = await resolveIbooksPaths();
  return { vault, config, paths };
}

export function printCommandError(error: unknown, fallback: string): void {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(fallback);
  }
  process.exitCode = 1;
}
