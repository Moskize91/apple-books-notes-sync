import type { Command } from "commander";
import { loadValidatedConfig } from "../lib/config";
import { resolveIbooksPaths } from "../lib/ibooks-paths";
import { runSync } from "../lib/sync";

type SyncOptions = {
  dryRun?: boolean;
  book?: string;
};

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Run note synchronization")
    .addHelpCommand(false)
    .showHelpAfterError("(run `absync sync --help` for usage)")
    .option("--dry-run", "preview changes without writing files")
    .option("--book <keyword>", "sync only books matching keyword, title, author, or asset id")
    .addHelpText(
      "after",
      `
What this does:
  Runs the same planning phase as absync plan, then writes changed Markdown files
  and removes stale managed output when appropriate.

Prerequisites:
  output.dir must be configured and valid:
    absync config set output.dir "/path/to/ObsidianVault"

Output layout:
  <output.dir>/<output.managedDirName>/
    index.md
    books/
      <book>.md
  assets/
    covers/
      <asset-id>.png
    pdf/
      <asset-id>/

Write rules:
  absync writes inside <output.dir>/<output.managedDirName>.
  A full sync may remove stale files that were previously managed by absync.
  A filtered sync with --book updates matching books only and does not process removals.

PDF rendering:
  Controlled by:
    absync config set pdf.enabled true|false
    absync config set pdf.renderer auto|swift|mutool|poppler

Recommended flow:
  absync plan
  absync sync

Examples:
  absync sync
  absync sync --dry-run
  absync sync --book "Newton"
`,
    )
    .action((options: SyncOptions) => {
      void (async () => {
        const config = await loadValidatedConfig();
        const paths = await resolveIbooksPaths();
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
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error("sync failed");
        }
        process.exitCode = 1;
      });
    });
}
