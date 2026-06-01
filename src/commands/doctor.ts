import type { Command } from "commander";
import { runDoctor } from "../lib/doctor";
import { loadCommandContext, printCommandError } from "./context";

type DoctorOptions = {
  vault?: string;
};

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run basic environment checks")
    .addHelpCommand(false)
    .showHelpAfterError("(run `absync doctor --help` for usage)")
    .option("--vault <selector>", "target vault id, vault name, or path")
    .addHelpText(
      "after",
      `
What this checks:
  macOS platform
  sqlite3 availability
  Apple Books database readability
  optional EPUB metadata cache readability
  Apple Books query health
  target vault plugin installation and settings
  output directory writability
  PDF renderer availability and selected renderer
  CPU architecture and Node.js version

Exit code:
  0 when all required checks pass.
  1 when any required check fails.

Optional renderer checks:
  mutool and pdftocairo are optional. Missing optional renderers are reported
  with install hints and do not fail the command by themselves.

Typical fixes:
  If Apple Books databases are missing or unreadable:
    open Apple Books once with the current macOS user
    make sure HOME has not been overridden or isolated
    run absync on macOS

  Install and enable Apple Books Notes Sync in the target Obsidian vault.

  Install optional PDF renderers:
    brew install mupdf-tools
    brew install poppler

Examples:
  absync doctor
  absync doctor --vault "MyVault"
`,
    )
    .action((options: DoctorOptions) => {
      void (async () => {
        const { config, paths } = await loadCommandContext(options);
        const report = await runDoctor(paths, config, null);

        for (const check of report.checks) {
          const status = check.ok ? "PASS" : "FAIL";
          console.log(`[${status}] ${check.name} - ${check.detail}`);
        }

        console.log("");
        console.log(
          `summary: syncable=${report.summary.books}, epub=${report.summary.epubBooks}, pdf=${report.summary.pdfBooks}, unsupported=${report.summary.unsupportedBooks}`,
        );

        if (!report.ok) {
          process.exitCode = 1;
        }
      })().catch((error: unknown) => {
        printCommandError(error, "doctor failed");
      });
    });
}
