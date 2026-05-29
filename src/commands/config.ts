import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Command } from "commander";
import {
  getConfigPath,
  getDefaultConfig,
  isPdfRenderBackend,
  readConfigOrDefault,
  writeConfig,
} from "../lib/config";
import { expandHome } from "../lib/path-utils";
import type { CliConfig } from "../lib/types";

type ConfigKey = "output.dir" | "output.managedDirName" | "pdf.enabled" | "pdf.renderer";

const CONFIG_KEYS: ConfigKey[] = ["output.dir", "output.managedDirName", "pdf.enabled", "pdf.renderer"];

function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as string[]).includes(value);
}

function keyError(key: string): Error {
  return new Error(`Unknown config key "${key}". Expected one of: ${CONFIG_KEYS.join(", ")}`);
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  throw new Error(`Invalid boolean value "${value}". Expected true or false.`);
}

function toPublicConfig(config: CliConfig): Record<ConfigKey, string> {
  return {
    "output.dir": config.outputDir,
    "output.managedDirName": config.managedDirName,
    "pdf.enabled": String(config.pdfBetaEnabled),
    "pdf.renderer": config.pdfRenderBackend,
  };
}

function getConfigValue(config: CliConfig, key: ConfigKey): string {
  return toPublicConfig(config)[key];
}

function setConfigValue(config: CliConfig, key: ConfigKey, value: string): CliConfig {
  if (key === "output.dir") {
    return { ...config, outputDir: path.resolve(expandHome(value)) };
  }
  if (key === "output.managedDirName") {
    if (value.trim().length === 0) {
      throw new Error("output.managedDirName cannot be empty.");
    }
    return { ...config, managedDirName: value };
  }
  if (key === "pdf.enabled") {
    return { ...config, pdfBetaEnabled: parseBoolean(value) };
  }
  if (key === "pdf.renderer") {
    if (!isPdfRenderBackend(value)) {
      throw new Error("Invalid pdf.renderer value. Expected one of: auto|swift|mutool|poppler");
    }
    return { ...config, pdfRenderBackend: value };
  }
  return config;
}

function unsetConfigValue(config: CliConfig, key: ConfigKey): CliConfig {
  const defaults = getDefaultConfig();
  if (key === "output.dir") {
    return { ...config, outputDir: defaults.outputDir };
  }
  if (key === "output.managedDirName") {
    return { ...config, managedDirName: defaults.managedDirName };
  }
  if (key === "pdf.enabled") {
    return { ...config, pdfBetaEnabled: defaults.pdfBetaEnabled };
  }
  if (key === "pdf.renderer") {
    return { ...config, pdfRenderBackend: defaults.pdfRenderBackend };
  }
  return config;
}

function printConfig(config: CliConfig): void {
  const publicConfig = toPublicConfig(config);
  for (const key of CONFIG_KEYS) {
    console.log(`${key}=${publicConfig[key]}`);
  }
}

async function runConfigAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("config failed");
    }
    process.exitCode = 1;
  }
}

export function registerConfigCommand(program: Command): void {
  const command = program.command("config").description("Manage CLI configuration");

  command
    .action(() => {
      void runConfigAction(async () => {
        printConfig(await readConfigOrDefault());
      });
    });

  command
    .command("path")
    .description("Print the config file path")
    .action(() => {
      console.log(getConfigPath());
    });

  command
    .command("list")
    .description("List effective config values")
    .action(() => {
      void runConfigAction(async () => {
        printConfig(await readConfigOrDefault());
      });
    });

  command
    .command("get")
    .description("Print a config value")
    .argument("<key>", `config key: ${CONFIG_KEYS.join("|")}`)
    .action((key: string) => {
      void runConfigAction(async () => {
        if (!isConfigKey(key)) {
          throw keyError(key);
        }
        console.log(getConfigValue(await readConfigOrDefault(), key));
      });
    });

  command
    .command("set")
    .description("Set a config value")
    .argument("<key>", `config key: ${CONFIG_KEYS.join("|")}`)
    .argument("<value>", "config value")
    .action((key: string, value: string) => {
      void runConfigAction(async () => {
        if (!isConfigKey(key)) {
          throw keyError(key);
        }
        const nextConfig = setConfigValue(await readConfigOrDefault(), key, value);
        await writeConfig(nextConfig);
        console.log(`${key}=${getConfigValue(nextConfig, key)}`);
      });
    });

  command
    .command("unset")
    .description("Reset a config value to its default")
    .argument("<key>", `config key: ${CONFIG_KEYS.join("|")}`)
    .action((key: string) => {
      void runConfigAction(async () => {
        if (!isConfigKey(key)) {
          throw keyError(key);
        }
        const nextConfig = unsetConfigValue(await readConfigOrDefault(), key);
        await writeConfig(nextConfig);
        console.log(`${key}=${getConfigValue(nextConfig, key)}`);
      });
    });

  command
    .command("edit")
    .description("Open the config file in $VISUAL or $EDITOR")
    .action(() => {
      void runConfigAction(async () => {
        await writeConfig(await readConfigOrDefault());
        const editor = process.env.VISUAL ?? process.env.EDITOR;
        if (!editor) {
          throw new Error("Set VISUAL or EDITOR to use `absync config edit`.");
        }
        const result = spawnSync(editor, [getConfigPath()], { stdio: "inherit", shell: true });
        if (result.error) {
          throw result.error;
        }
        if (result.status && result.status !== 0) {
          process.exitCode = result.status;
        }
      });
    });
}
