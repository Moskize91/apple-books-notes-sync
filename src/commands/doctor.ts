import type { Command } from "commander";
import { ConfigValidationError, loadValidatedConfig } from "../lib/config";
import { resolveIbooksPaths } from "../lib/ibooks-paths";
import { runDoctor } from "../lib/doctor";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run basic environment checks")
    .addHelpCommand(false)
    .showHelpAfterError("(run `absync doctor --help` for usage)")
    .addHelpText(
      "after",
      `
What this checks:
  macOS platform
  sqlite3 availability
  Apple Books database readability
  optional EPUB metadata cache readability
  Apple Books query health
  config validity
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

  Configure the Obsidian vault:
    absync config set output.dir "/path/to/ObsidianVault"

  Install optional PDF renderers:
    brew install mupdf-tools
    brew install poppler

Examples:
  absync doctor
`,
    )
    .action(() => {
      void (async () => {
        const paths = await resolveIbooksPaths();
        let config = null;
        let configError: ConfigValidationError | null = null;
        try {
          config = await loadValidatedConfig();
        } catch (error: unknown) {
          if (error instanceof ConfigValidationError) {
            configError = error;
          } else {
            throw error;
          }
        }
        const report = await runDoctor(paths, config, configError);

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
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error("doctor failed");
        }
        process.exitCode = 1;
      });
    });
}
