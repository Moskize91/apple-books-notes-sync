import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import {
  getDefaultBooksBaseRelativePath,
  normalizeVaultRelativePath,
  renderBooksBase,
} from "../lib/books-base";
import { readSyncConfigFromVault } from "../lib/plugin-settings";
import { resolveVault } from "../lib/vault";
import { printCommandError } from "./context";

type BaseCreateOptions = {
  path?: string;
  overwrite?: boolean;
  json?: boolean;
  vault?: string;
};

type BaseCreateResult = {
  path: string;
  absolutePath: string;
  status: "created" | "exists" | "overwritten";
};

async function createBooksBase(options: BaseCreateOptions): Promise<BaseCreateResult> {
  const vault = await resolveVault(options.vault);
  const config = await readSyncConfigFromVault(vault.path);
  const relativePath = options.path
    ? normalizeVaultRelativePath(options.path, "base path")
    : getDefaultBooksBaseRelativePath(config.managedDirName);
  if (path.posix.extname(relativePath).toLowerCase() !== ".base") {
    throw new Error("base path must end with .base.");
  }

  const absolutePath = path.join(config.vaultDir, relativePath);
  const content = renderBooksBase({ managedDirName: config.managedDirName });
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  try {
    if (options.overwrite) {
      await fs.writeFile(absolutePath, content, "utf8");
      return { path: relativePath, absolutePath, status: "overwritten" };
    }
    await fs.writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    return { path: relativePath, absolutePath, status: "created" };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      return { path: relativePath, absolutePath, status: "exists" };
    }
    throw error;
  }
}

export function registerBaseCommand(program: Command): void {
  const base = program.command("base").description("Manage Obsidian Bases for synced Apple Books notes").addHelpCommand(false);

  base
    .command("create")
    .description("Create the Books.base view for synced book notes")
    .addHelpCommand(false)
    .showHelpAfterError("(run `absync base create --help` for usage)")
    .option("--vault <selector>", "target vault id, vault name, or path")
    .option("--path <path>", "vault-relative .base path (default: <managedDirName>/Books.base)")
    .option("--overwrite", "overwrite the existing .base file")
    .option("--json", "print machine-readable JSON output")
    .addHelpText(
      "after",
      `
What this does:
  Creates an Obsidian Bases file that lists synced book notes from
  <managedDirName>/books. It does not read Apple Books databases.

Examples:
  absync base create
  absync base create --vault "MyVault"
  absync base create --path "Apple Books Notes/Books.base"
  absync base create --overwrite
`,
    )
    .action((options: BaseCreateOptions) => {
      void (async () => {
        const result = await createBooksBase(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.status === "exists") {
          console.log(`Books Base already exists: ${result.path}`);
        } else {
          console.log(`Books Base ${result.status}: ${result.path}`);
        }
      })().catch((error: unknown) => {
        printCommandError(error, "base create failed");
      });
    });
}
