#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { registerBooksCommand } from "./commands/books";
import { registerDoctorCommand } from "./commands/doctor";
import { registerPlanCommand } from "./commands/plan";
import { registerSyncCommand } from "./commands/sync";
import { registerVaultsCommand } from "./commands/vaults";

function readPackageVersion(): string {
  const packageJsonPath = path.resolve(__dirname, "../package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("absync")
  .description("Sync Apple Books highlights and notes to local Markdown files")
  .version(readPackageVersion())
  .addHelpCommand(false)
  .showHelpAfterError("(run `absync --help` for usage)")
  .addHelpText(
    "after",
    `
Help:
  Use --help on any command to open the next level of documentation:

    absync plan --help
    absync sync --help
    absync books --help
    absync doctor --help
    absync vaults --help

Typical workflow:
  1. Install and enable the Apple Books Notes Sync plugin in an Obsidian vault.

  2. Check the local environment:
       absync doctor

  3. Preview pending changes:
       absync plan

  4. Sync notes:
       absync sync

Vault selection:
  absync auto-detects vaults from Obsidian. Use --vault with a vault id, name,
  or path when more than one target vault is available.

  Sync output directory:
    <vault>/<managedDirName>

Rules:
  The target vault must have the Apple Books Notes Sync plugin installed and enabled.
  absync reads Apple Books data from the local macOS Apple Books databases.
  absync writes only inside the managed output directory under the selected vault.
`,
  );

registerPlanCommand(program);
registerSyncCommand(program);
registerBooksCommand(program);
registerDoctorCommand(program);
registerVaultsCommand(program);

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error");
  }
  process.exit(1);
});
