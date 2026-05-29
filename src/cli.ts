#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { registerBooksCommand } from "./commands/books";
import { registerConfigCommand } from "./commands/config";
import { registerDoctorCommand } from "./commands/doctor";
import { registerPlanCommand } from "./commands/plan";
import { registerSyncCommand } from "./commands/sync";

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

    absync config --help
    absync plan --help
    absync sync --help
    absync books --help
    absync doctor --help

Typical workflow:
  1. Configure the Obsidian vault root:
       absync config set output.dir "/path/to/ObsidianVault"

  2. Check the local environment:
       absync doctor

  3. Preview pending changes:
       absync plan

  4. Sync notes:
       absync sync

Important paths:
  Config file:
    ~/Library/Application Support/apple-books-notes-sync/config.json

  Sync output directory:
    <output.dir>/<output.managedDirName>

Rules:
  output.dir is required. It must be an existing Obsidian vault root and contain .obsidian/.
  absync reads Apple Books data from the local macOS Apple Books databases.
  absync writes only inside the managed output directory under the configured vault.
`,
  );

registerConfigCommand(program);
registerPlanCommand(program);
registerSyncCommand(program);
registerBooksCommand(program);
registerDoctorCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unexpected error");
  }
  process.exit(1);
});
