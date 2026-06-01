import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  getPluginDir,
  getDefaultPluginSettings,
  normalizePluginSettings,
  type PluginSettings,
} from "../lib/plugin-settings";
import type { PdfRenderBackend, SyncStats, SyncableBookFormat } from "../lib/types";

type PluginCommandResult = {
  status: "success" | "warning";
  notice: string;
  details: string;
};

type VisibleCommandOptions = {
  reportDialogOnSuccess: boolean;
};

type SpawnResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type ResolvedCli = {
  command: string;
  version: string;
};

type Semver = {
  major: number;
  minor: number;
  patch: number;
};

type CliPlanBook = {
  title: string;
  format: SyncableBookFormat;
  bookFileRelativePath: string | null;
  reason: string;
};

type CliPlanResult = {
  outputDir: string;
  summary: {
    totalBooks: number;
    changedBooks: number;
    unchangedBooks: number;
    removedBooks: number;
  };
  changed: CliPlanBook[];
  unchanged: CliPlanBook[];
  removed: CliPlanBook[];
};

type CliSyncResult = {
  outputDir: string;
  summary: SyncStats;
};

type CliDoctorReport = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  summary: {
    books: number;
    epubBooks: number;
    pdfBooks: number;
    unsupportedBooks: number;
  };
};

type CliJsonResult<T> = {
  data: T;
  cli: ResolvedCli;
  stderr: string;
};

export default class AppleBooksNotesSyncPlugin extends Plugin {
  settings: PluginSettings = getDefaultPluginSettings();
  private commandRunning = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AppleBooksNotesSyncSettingTab(this.app, this));

    this.addCommand({
      id: "sync",
      name: "Sync",
      callback: () => {
        void this.runSyncCommand(false);
      },
    });
    this.addCommand({
      id: "preview-sync-plan",
      name: "Plan",
      callback: () => {
        void this.previewPlan();
      },
    });
    this.addCommand({
      id: "doctor",
      name: "Doctor",
      callback: () => {
        void this.runDoctorCommand();
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizePluginSettings((await this.loadData()) as Partial<PluginSettings> | null);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private getVaultDir(): string {
    const adapter = this.app.vault.adapter;
    const getBasePath =
      "getBasePath" in adapter ? (adapter as { getBasePath?: unknown }).getBasePath : null;
    if (typeof getBasePath === "function") {
      return getBasePath.call(adapter) as string;
    }
    const basePath = "basePath" in adapter ? (adapter as { basePath?: unknown }).basePath : null;
    if (typeof basePath !== "string" || basePath.length === 0) {
      throw new Error("Apple Books Notes Sync requires Obsidian desktop with a local filesystem vault.");
    }
    return basePath;
  }

  private getSyncConfig() {
    return {
      vaultDir: this.getVaultDir(),
    };
  }

  private async previewPlan(): Promise<void> {
    await this.runVisibleCommand("absync plan", async () => {
      const { data: plan, cli, stderr } = await this.runAbsyncJson<CliPlanResult>("plan", [
        "plan",
        "--vault",
        this.getSyncConfig().vaultDir,
        "--json",
      ]);
      return {
        status: "success",
        notice: `${plan.summary.changedBooks} changed, ${plan.summary.unchangedBooks} unchanged, ${plan.summary.removedBooks} removed.`,
        details: [this.formatCliExecution(cli, stderr), "", this.formatPlan(plan)].join("\n"),
      };
    });
  }

  private async runSyncCommand(dryRun: boolean): Promise<void> {
    await this.runVisibleCommand(dryRun ? "absync sync --dry-run" : "absync sync", async () => {
      const args = ["sync", "--vault", this.getSyncConfig().vaultDir, "--json"];
      if (dryRun) {
        args.push("--dry-run");
      }
      const { data: result, cli, stderr } = await this.runAbsyncJson<CliSyncResult>("sync", args);
      return {
        status: result.summary.failedBooks > 0 ? "warning" : "success",
        notice: `${result.summary.successBooks} success, ${result.summary.failedBooks} failed, ${result.summary.generatedFiles} files.`,
        details: [
          this.formatCliExecution(cli, stderr),
          "",
          `Command: ${dryRun ? "absync sync --dry-run" : "absync sync"}`,
          `Output: ${result.outputDir}`,
          "",
          `Summary: total=${result.summary.totalBooks}, success=${result.summary.successBooks}, failed=${result.summary.failedBooks}, skipped=${result.summary.skippedBooks}, files=${result.summary.generatedFiles}`,
        ].join("\n"),
      };
    }, { reportDialogOnSuccess: false });
  }

  private async runDoctorCommand(): Promise<void> {
    await this.runVisibleCommand("absync doctor", async () => {
      const { data: report, cli, stderr } = await this.runAbsyncJson<CliDoctorReport>("doctor", [
        "doctor",
        "--vault",
        this.getSyncConfig().vaultDir,
        "--json",
      ]);
      const failed = report.checks.filter((check) => !check.ok);
      return {
        status: failed.length === 0 ? "success" : "warning",
        notice:
          failed.length === 0
            ? `passed. Syncable books: ${report.summary.books}.`
            : `found ${failed.length} issue(s). First: ${failed[0]?.name}: ${failed[0]?.detail}`,
        details: [
          this.formatCliExecution(cli, stderr),
          "",
          "Command: absync doctor",
          "",
          ...report.checks.map((check) => `[${check.ok ? "PASS" : "FAIL"}] ${check.name} - ${check.detail}`),
          "",
          `Summary: syncable=${report.summary.books}, epub=${report.summary.epubBooks}, pdf=${report.summary.pdfBooks}, unsupported=${report.summary.unsupportedBooks}`,
        ].join("\n"),
      };
    });
  }

  private async runAbsyncJson<T>(label: string, args: string[]): Promise<CliJsonResult<T>> {
    const cli = await this.resolveAbsyncCli();
    const result = await this.runProcess(cli.command, args, this.getVaultDir());
    if (result.exitCode !== 0) {
      throw new Error(
        [
          `absync ${label} failed with exit code ${result.exitCode ?? "unknown"}.`,
          result.stderr.trim(),
          result.stdout.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    try {
      return {
        data: JSON.parse(result.stdout) as T,
        cli,
        stderr: result.stderr,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "invalid JSON";
      const wrapped = new Error(`absync ${label} returned invalid JSON: ${message}\n${result.stdout.trim()}`);
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
  }

  private formatCliExecution(cli: ResolvedCli, stderr: string): string {
    const lines = [`CLI: ${cli.command}`, `CLI version: ${cli.version}`];
    const trimmedStderr = stderr.trim();
    if (trimmedStderr.length > 0) {
      lines.push("", "CLI log:", trimmedStderr);
    }
    return lines.join("\n");
  }

  private async resolveAbsyncCli(): Promise<ResolvedCli> {
    const configured = this.settings.absyncPath?.trim();
    if (configured) {
      const command = this.expandHome(configured);
      const resolved = await this.probeCli(command);
      if (resolved) {
        return resolved;
      }
      throw new Error(
        [
          `Configured absync CLI was not usable: ${command}`,
          "Install or update the CLI with:",
          "  npm install -g apple-books-notes-sync",
          "Or clear the setting to let the plugin auto-detect absync.",
        ].join("\n"),
      );
    }

    const candidates = await this.getCliCandidates();
    let incompatibleCliError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const resolved = await this.probeCli(candidate);
        if (resolved) {
          return resolved;
        }
      } catch (error: unknown) {
        if (!incompatibleCliError && error instanceof Error) {
          incompatibleCliError = error;
        }
      }
    }
    if (incompatibleCliError) {
      throw incompatibleCliError;
    }

    throw new Error(
      [
        "absync CLI was not found.",
        "Install it with:",
        "  npm install -g apple-books-notes-sync",
        "If it is already installed, set the full absync path in this plugin's settings.",
        "",
        `Checked: ${candidates.join(", ")}`,
      ].join("\n"),
    );
  }

  private async getCliCandidates(): Promise<string[]> {
    const candidates = [
      "absync",
      "/opt/homebrew/bin/absync",
      "/usr/local/bin/absync",
      path.join(os.homedir(), ".npm-global", "bin", "absync"),
      path.join(os.homedir(), ".local", "bin", "absync"),
    ];
    const shellResolved = await this.resolveCliFromShell();
    if (shellResolved) {
      candidates.unshift(shellResolved);
    }
    return [...new Set(candidates)];
  }

  private async resolveCliFromShell(): Promise<string | null> {
    const result = await this.runProcess("/bin/zsh", ["-lc", "command -v absync"], this.getVaultDir(), 5000);
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? null;
  }

  private async probeCli(command: string): Promise<ResolvedCli | null> {
    const result = await this.runProcess(command, ["--version"], this.getVaultDir(), 5000);
    if (result.exitCode !== 0) {
      return null;
    }
    const version = this.parseVersion(result.stdout);
    if (!version) {
      return null;
    }
    this.assertCompatibleCliVersion(version, command);
    return { command, version };
  }

  private parseVersion(output: string): string | null {
    return output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? null;
  }

  private assertCompatibleCliVersion(cliVersion: string, command: string): void {
    const pluginVersion = this.manifest.version;
    const cli = this.parseSemver(cliVersion);
    const plugin = this.parseSemver(pluginVersion);
    if (!cli || !plugin) {
      return;
    }

    const cliIsOlder =
      cli.major < plugin.major ||
      (cli.major === plugin.major && cli.minor < plugin.minor) ||
      (cli.major === plugin.major && cli.minor === plugin.minor && cli.patch < plugin.patch);
    const incompatibleMajor = cli.major !== plugin.major;
    const incompatibleZeroMinor = plugin.major === 0 && cli.minor !== plugin.minor;
    if (!cliIsOlder && !incompatibleMajor && !incompatibleZeroMinor) {
      return;
    }

    throw new Error(
      [
        `absync CLI version ${cliVersion} is not compatible with plugin version ${pluginVersion}.`,
        `CLI path: ${command}`,
        "Update the CLI with:",
        "  npm install -g apple-books-notes-sync",
      ].join("\n"),
    );
  }

  private parseSemver(version: string): Semver | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      return null;
    }
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    };
  }

  private runProcess(command: string, args: string[], cwd: string, timeoutMs = 0): Promise<SpawnResult> {
    return new Promise((resolve) => {
      const env = this.buildProcessEnv();
      const child = spawn(command, args, { cwd, env, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: SpawnResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(result);
      };

      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          child.kill();
          finish({ exitCode: null, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms.`.trim() });
        }, timeoutMs);
      }

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        finish({ exitCode: null, stdout, stderr: error.message });
      });
      child.on("close", (exitCode) => {
        finish({ exitCode, stdout, stderr });
      });
    });
  }

  private buildProcessEnv(): NodeJS.ProcessEnv {
    const commonPaths = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      path.join(os.homedir(), ".npm-global", "bin"),
      path.join(os.homedir(), ".local", "bin"),
    ];
    const pathValue = [process.env.PATH, ...commonPaths].filter(Boolean).join(":");
    return { ...process.env, PATH: pathValue };
  }

  private expandHome(input: string): string {
    if (input === "~") {
      return os.homedir();
    }
    if (input.startsWith("~/")) {
      return path.join(os.homedir(), input.slice(2));
    }
    return input;
  }

  private async runVisibleCommand(
    command: string,
    action: () => Promise<PluginCommandResult>,
    options: VisibleCommandOptions = { reportDialogOnSuccess: true },
  ): Promise<void> {
    if (this.commandRunning) {
      new Notice("Apple Books Notes Sync: another absync command is still running.", 8000);
      return;
    }

    this.commandRunning = true;
    new Notice(`Apple Books Notes Sync: running ${command}...`, 4000);

    const lines: string[] = [`Command: ${command}`, `Started: ${new Date().toISOString()}`, ""];

    try {
      const result = await action();
      lines.push("", result.details);
      const logPath = await this.safeWriteCommandLog(command, lines.join("\n"));
      const title = `Apple Books Notes Sync: ${command}`;
      const details = `${lines.join("\n")}\n\nLog file: ${logPath}`;
      new Notice(`Apple Books Notes Sync: ${command} ${result.notice}`, result.status === "warning" ? 20000 : 10000);
      if (options.reportDialogOnSuccess || result.status === "warning") {
        new CommandResultModal(this.app, title, details).open();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error && error.stack ? error.stack : message;
      lines.push("", "FAILED", stack);
      const logPath = await this.safeWriteCommandLog(command, lines.join("\n"));
      const details = `${lines.join("\n")}\n\nLog file: ${logPath}`;
      console.error(`[Apple Books Notes Sync] ${command} failed`, error);
      new Notice(`Apple Books Notes Sync: ${command} failed. ${message}`, 30000);
      new CommandResultModal(this.app, `Apple Books Notes Sync: ${command} failed`, details).open();
    } finally {
      this.commandRunning = false;
    }
  }

  private async safeWriteCommandLog(command: string, content: string): Promise<string> {
    try {
      return await this.writeCommandLog(command, content);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Apple Books Notes Sync] failed to write ${command} log`, error);
      return `not written (${message})`;
    }
  }

  private async writeCommandLog(command: string, content: string): Promise<string> {
    const logDir = path.join(getPluginDir(this.getVaultDir()), "logs");
    await fs.mkdir(logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const commandName = command.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const logPath = path.join(logDir, `${timestamp}-${commandName}.log`);
    await fs.writeFile(logPath, `${content}\n`, "utf8");
    return logPath;
  }

  private formatPlan(plan: CliPlanResult): string {
    return [
      "Command: absync plan",
      `Output: ${plan.outputDir}`,
      "",
      "Changed:",
      ...this.formatPlanItems(plan.changed),
      "",
      "Removed:",
      ...this.formatPlanItems(plan.removed),
      "",
      "Unchanged:",
      `  ${plan.unchanged.length} books`,
      "",
      `Summary: total=${plan.summary.totalBooks}, changed=${plan.summary.changedBooks}, unchanged=${plan.summary.unchangedBooks}, removed=${plan.summary.removedBooks}`,
    ].join("\n");
  }

  private formatPlanItems(items: CliPlanBook[]): string[] {
    if (items.length === 0) {
      return ["  none"];
    }
    return items.map((item) => {
      const outputPath = item.bookFileRelativePath ? ` -> ${item.bookFileRelativePath}` : "";
      return `  - [${item.format}] ${item.title} (${item.reason})${outputPath}`;
    });
  }
}

class CommandResultModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly details: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.titleText });

    const pre = contentEl.createEl("pre");
    pre.setText(this.details);
    pre.style.whiteSpace = "pre-wrap";
    pre.style.maxHeight = "60vh";
    pre.style.overflow = "auto";

    new Setting(contentEl).addButton((button) => {
      button.setButtonText("Copy details").onClick(() => {
        const clipboard = (navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } }).clipboard;
        void clipboard?.writeText(this.details);
        new Notice("Apple Books Notes Sync: command details copied.", 4000);
      });
    });
  }
}

class AppleBooksNotesSyncSettingTab extends PluginSettingTab {
  constructor(
    app: PluginSettingTab["app"],
    private readonly plugin: AppleBooksNotesSyncPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Managed folder")
      .setDesc("Folder inside the current vault where generated notes and assets are written.")
      .addText((text) => {
        text
          .setPlaceholder("Apple Books Notes")
          .setValue(this.plugin.settings.managedDirName)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.managedDirName = value.trim() || getDefaultPluginSettings().managedDirName;
              await this.plugin.saveSettings();
            })();
          });
      });

    new Setting(containerEl)
      .setName("absync CLI path")
      .setDesc("Optional full path to absync. Leave empty to auto-detect from PATH and common install locations.")
      .addText((text) => {
        text
          .setPlaceholder("/opt/homebrew/bin/absync")
          .setValue(this.plugin.settings.absyncPath ?? "")
          .onChange((value) => {
            void (async () => {
              const trimmed = value.trim();
              if (trimmed.length > 0) {
                this.plugin.settings.absyncPath = trimmed;
              } else {
                delete this.plugin.settings.absyncPath;
              }
              await this.plugin.saveSettings();
            })();
          });
      });

    new Setting(containerEl)
      .setName("PDF rendering")
      .setDesc("Generate PDF note page images when PDF annotations are synced.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.pdfBetaEnabled).onChange((value) => {
          void (async () => {
            this.plugin.settings.pdfBetaEnabled = value;
            await this.plugin.saveSettings();
          })();
        });
      });

    new Setting(containerEl)
      .setName("PDF renderer")
      .setDesc("External renderer used for PDF page images.")
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            auto: "auto",
            swift: "swift",
            mutool: "mutool",
            poppler: "poppler",
          })
          .setValue(this.plugin.settings.pdfRenderBackend)
          .onChange((value) => {
            void (async () => {
              this.plugin.settings.pdfRenderBackend = value as PdfRenderBackend;
              await this.plugin.saveSettings();
            })();
          });
      });
  }
}
