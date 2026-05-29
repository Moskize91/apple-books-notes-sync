#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { registerBooksCommand } from "./commands/books";
import { registerDoctorCommand } from "./commands/doctor";
import { registerInitCommand } from "./commands/init";
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
  .version(readPackageVersion());

registerInitCommand(program);
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
