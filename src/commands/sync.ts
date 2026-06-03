import type { Command } from "commander";
import { setLogHandler } from "../lib/logger";
import { runSync, type SyncProgressEvent } from "../lib/sync";
import { loadCommandContext, printCommandError } from "./context";

type SyncOptions = {
  dryRun?: boolean;
  book?: string;
  json?: boolean;
  progress?: string;
  vault?: string;
};

type CliProgressEvent = SyncProgressEvent | { type: "log"; level: string; message: string } | { type: "error"; message: string };

function writeProgressEvent(event: CliProgressEvent): void {
  console.error(JSON.stringify(event));
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Run note synchronization")
    .addHelpCommand(false)
    .showHelpAfterError("(run `absync sync --help` for usage)")
    .option("--vault <selector>", "target vault id, vault name, or path")
    .option("--dry-run", "preview changes without writing files")
    .option("--book <keyword>", "sync only books matching keyword, title, author, or asset id")
    .option("--json", "print machine-readable JSON output")
    .option("--progress <format>", "emit progress events to stderr (jsonl)")
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
    Books.base
    books/
      <book>.md
      <book>/
        <chapter>.md
  assets/
    covers/
      <asset-id>.png
    pdf/
      <asset-id>/

Write rules:
  absync writes inside <vault>/<managedDirName>.
  A full sync may remove stale files that were previously managed by absync.
  A filtered sync with --book updates matching books only and does not process removals.
  Obsidian .base files are never overwritten or removed by sync.

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
        if (options.progress && options.progress !== "jsonl") {
          throw new Error(`Unsupported progress format: ${options.progress}`);
        }
        const syncOptions: { dryRun: boolean; bookFilter?: string; onProgress?: (event: SyncProgressEvent) => void } = {
          dryRun: Boolean(options.dryRun),
        };
        if (options.book) {
          syncOptions.bookFilter = options.book;
        }
        if (options.progress === "jsonl") {
          syncOptions.onProgress = writeProgressEvent;
        }

        const restoreLogHandler =
          options.progress === "jsonl"
            ? setLogHandler((level, message) => {
                writeProgressEvent({ type: "log", level, message });
              })
            : options.json
              ? setLogHandler((level, message) => {
                  const prefix = level.toUpperCase();
                  console.error(`[${prefix}] ${message}`);
                })
              : null;
        let result: Awaited<ReturnType<typeof runSync>>;
        try {
          result = await runSync(config, paths, syncOptions);
        } finally {
          restoreLogHandler?.();
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                outputDir: result.outputDir,
                summary: result.stats,
              },
              null,
              2,
            ),
          );
          return;
        }

        const prefix = options.dryRun ? "dry-run" : "sync";
        console.log(
          `${prefix} summary: total=${result.stats.totalBooks}, success=${result.stats.successBooks}, failed=${result.stats.failedBooks}, skipped=${result.stats.skippedBooks}, files=${result.stats.generatedFiles}`,
        );
        console.log(`output: ${result.outputDir}`);
      })().catch((error: unknown) => {
        if (options.progress === "jsonl") {
          writeProgressEvent({ type: "error", message: error instanceof Error ? error.message : "sync failed" });
          process.exitCode = 1;
          return;
        }
        printCommandError(error, "sync failed");
      });
    });
}
