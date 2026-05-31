import type { Command } from "commander";
import { runSync } from "../lib/sync";
import { loadCommandContext, printCommandError } from "./context";

type SyncOptions = {
  dryRun?: boolean;
  book?: string;
  vault?: string;
};

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Run note synchronization")
    .addHelpCommand(false)
    .showHelpAfterError("(run `absync sync --help` for usage)")
    .option("--vault <selector>", "target vault id, vault name, or path")
    .option("--dry-run", "preview changes without writing files")
    .option("--book <keyword>", "sync only books matching keyword, title, author, or asset id")
    .addHelpText(
      "after",
      `
What this does:
  Runs the same planning phase as absync plan, then writes changed Markdown files
  and removes stale managed output when appropriate.

Prerequisites:
  Apple Books Notes Sync must be installed and enabled in the target vault.

Output layout:
  <vault>/<managedDirName>/
    index.md
    books/
      <book>.md
  assets/
    covers/
      <asset-id>.png
    pdf/
      <asset-id>/

Write rules:
  absync writes inside <vault>/<managedDirName>.
  A full sync may remove stale files that were previously managed by absync.
  A filtered sync with --book updates matching books only and does not process removals.

PDF rendering:
  Controlled by the target vault's plugin settings.

Recommended flow:
  absync plan
  absync sync

Examples:
  absync sync
  absync sync --vault "MyVault"
  absync sync --dry-run
  absync sync --book "Newton"
`,
    )
    .action((options: SyncOptions) => {
      void (async () => {
        const { config, paths } = await loadCommandContext(options);
        const syncOptions: { dryRun: boolean; bookFilter?: string } = {
          dryRun: Boolean(options.dryRun),
        };
        if (options.book) {
          syncOptions.bookFilter = options.book;
        }

        const result = await runSync(config, paths, syncOptions);

        const prefix = options.dryRun ? "dry-run" : "sync";
        console.log(
          `${prefix} summary: total=${result.stats.totalBooks}, success=${result.stats.successBooks}, failed=${result.stats.failedBooks}, skipped=${result.stats.skippedBooks}, files=${result.stats.generatedFiles}`,
        );
        console.log(`output: ${result.outputDir}`);
      })().catch((error: unknown) => {
        printCommandError(error, "sync failed");
      });
    });
}
