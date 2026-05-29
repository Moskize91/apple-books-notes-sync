import type { Command } from "commander";
import { loadValidatedConfig } from "../lib/config";
import { resolveIbooksPaths } from "../lib/ibooks-paths";
import { buildSyncPlan, type SyncPlan, type SyncPlanBook, type SyncPlanRemovedBook } from "../lib/sync";

type PlanOptions = {
  book?: string;
  json?: boolean;
};

function printBook(item: SyncPlanBook | SyncPlanRemovedBook): void {
  const outputPath = item.bookFileRelativePath ? ` -> ${item.bookFileRelativePath}` : "";
  console.log(`  - [${item.format}] ${item.title} (${item.reason})${outputPath}`);
}

function printPlan(plan: SyncPlan): void {
  console.log("Sync plan");
  console.log("");
  console.log(`Output: ${plan.outputDir}`);
  console.log("");

  console.log("Changed:");
  if (plan.changed.length === 0) {
    console.log("  none");
  } else {
    for (const item of plan.changed) {
      printBook(item);
    }
  }
  console.log("");

  console.log("Removed:");
  if (plan.removed.length === 0) {
    console.log("  none");
  } else {
    for (const item of plan.removed) {
      printBook(item);
    }
  }
  console.log("");

  console.log("Unchanged:");
  console.log(`  ${plan.unchanged.length} books`);
  console.log("");

  console.log(
    `Summary: total=${plan.stats.totalBooks}, changed=${plan.stats.changedBooks}, unchanged=${plan.stats.unchangedBooks}, removed=${plan.stats.removedBooks}`,
  );
}

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Preview which books need synchronization")
    .option("--book <keyword>", "plan only books matching keyword/title/asset id")
    .option("--json", "print JSON output")
    .action((options: PlanOptions) => {
      void (async () => {
        const config = await loadValidatedConfig();
        const paths = await resolveIbooksPaths();
        const planOptions: { bookFilter?: string } = {};
        if (options.book) {
          planOptions.bookFilter = options.book;
        }
        const plan = await buildSyncPlan(config, paths, planOptions);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                outputDir: plan.outputDir,
                summary: plan.stats,
                changed: plan.changed,
                unchanged: plan.unchanged,
                removed: plan.removed,
              },
              null,
              2,
            ),
          );
          return;
        }

        printPlan(plan);
      })().catch((error: unknown) => {
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error("plan failed");
        }
        process.exitCode = 1;
      });
    });
}
