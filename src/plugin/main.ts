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

type ProcessOptions = {
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
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

type CliProgressEvent =
  | {
      type: "plan";
      totalBooks: number;
      changedBooks: number;
      unchangedBooks: number;
      removedBooks: number;
    }
  | {
      type: "book";
      phase: "dry-run preparing" | "syncing";
      index: number;
      total: number;
      title: string;
      format: SyncableBookFormat;
    }
  | {
      type: "warning";
      title: string;
      message: string;
    }
  | {
      type: "complete";
      successBooks: number;
      failedBooks: number;
      skippedBooks: number;
      generatedFiles: number;
    }
  | {
      type: "log";
      level: string;
      message: string;
    }
  | {
      type: "error";
      message: string;
    };

type CliResolutionFailure = {
  checked: string[];
  configuredPath: string | null;
  incompatibleError: string | null;
};

class CliResolutionError extends Error {
  constructor(
    message: string,
    readonly failure: CliResolutionFailure,
  ) {
    super(message);
    this.name = "CliResolutionError";
  }
}

export default class AppleBooksNotesSyncPlugin extends Plugin {
  settings: PluginSettings = getDefaultPluginSettings();
  private commandRunning = false;
  private statusBarEl: HTMLElement | null = null;
  private statusClearTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AppleBooksNotesSyncSettingTab(this.app, this));
    this.addRibbonIcon("book-open-check", "Sync Apple Books notes", () => {
      void this.runSyncCommand(false);
    });

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
      this.updateStatusBar(dryRun ? "ABS dry-run starting..." : "ABS sync starting...");
      const args = ["sync", "--vault", this.getSyncConfig().vaultDir, "--json", "--progress", "jsonl"];
      if (dryRun) {
        args.push("--dry-run");
      }
      const { data: result, cli, stderr } = await this.runAbsyncJson<CliSyncResult>("sync", args, {
        onProgress: (event) => {
          this.handleSyncProgress(event, dryRun);
        },
      });
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

  private async runAbsyncJson<T>(
    label: string,
    args: string[],
    options: { onProgress?: (event: CliProgressEvent) => void } = {},
  ): Promise<CliJsonResult<T>> {
    const cli = await this.resolveAbsyncCli();
    const progressParser = options.onProgress ? this.createProgressParser(options.onProgress) : null;
    const result = await this.runProcess(cli.command, args, this.getVaultDir(), {
      onStderr: (chunk) => {
        progressParser?.(chunk);
      },
    });
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

  private createProgressParser(onProgress: (event: CliProgressEvent) => void): (chunk: string) => void {
    let buffer = "";
    return (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as CliProgressEvent;
          if (typeof parsed.type === "string") {
            onProgress(parsed);
          }
        } catch {
          // Non-JSON stderr is still preserved for command logs.
        }
      }
    };
  }

  private handleSyncProgress(event: CliProgressEvent, dryRun: boolean): void {
    if (event.type === "plan") {
      const action = dryRun ? "dry-run" : "sync";
      this.updateStatusBar(`ABS ${action}: 0/${event.changedBooks} planned`);
      return;
    }
    if (event.type === "book") {
      const title = event.title.length > 36 ? `${event.title.slice(0, 35)}...` : event.title;
      const action = dryRun ? "dry-run" : "sync";
      this.updateStatusBar(`ABS ${action}: ${event.index}/${event.total} ${title}`);
      return;
    }
    if (event.type === "warning") {
      this.updateStatusBar(`ABS warning: ${event.title}`);
      return;
    }
    if (event.type === "complete") {
      this.updateStatusBar(`ABS done: ${event.successBooks} ok, ${event.failedBooks} failed`);
      return;
    }
    if (event.type === "error") {
      this.updateStatusBar("ABS failed");
    }
  }

  private updateStatusBar(text: string): void {
    if (this.statusClearTimer) {
      clearTimeout(this.statusClearTimer);
      this.statusClearTimer = null;
    }
    if (!this.statusBarEl) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass("apple-books-notes-sync-status");
    }
    this.statusBarEl.setText(text);
  }

  private finishStatusBar(text: string): void {
    this.updateStatusBar(text);
    this.statusClearTimer = setTimeout(() => {
      this.statusBarEl?.detach();
      this.statusBarEl = null;
      this.statusClearTimer = null;
    }, 10000);
  }

  async detectAndSaveAbsyncCli(): Promise<boolean> {
    new Notice("Apple Books Notes Sync: detecting absync CLI...", 4000);
    try {
      const cli = await this.detectAbsyncCli();
      this.settings.absyncPath = cli.command;
      await this.saveSettings();
      new Notice(`Apple Books Notes Sync: absync CLI set to ${cli.command}`, 10000);
      return true;
    } catch (error: unknown) {
      if (error instanceof CliResolutionError) {
        new CliSetupModal(this.app, this.buildCliSetupDetails(error.failure)).open();
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      new CommandResultModal(this.app, "Apple Books Notes Sync: absync CLI detection failed", message).open();
      return false;
    }
  }

  async testConfiguredAbsyncCli(): Promise<void> {
    try {
      const cli = await this.resolveAbsyncCli();
      new Notice(`Apple Books Notes Sync: ✓ absync CLI works (${cli.version}).`, 8000);
    } catch (error: unknown) {
      if (error instanceof CliResolutionError) {
        new CommandResultModal(
          this.app,
          "Apple Books Notes Sync: CLI path test failed",
          [
            "The configured absync CLI path did not work.",
            "",
            "Click Detect in this plugin's settings, or paste the path from Terminal:",
            "  command -v absync",
            ...(error.failure.configuredPath ? ["", `Configured path: ${error.failure.configuredPath}`] : []),
          ].join("\n"),
        ).open();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      new CommandResultModal(this.app, "Apple Books Notes Sync: CLI path test failed", message).open();
    }
  }

  private async resolveAbsyncCli(): Promise<ResolvedCli> {
    const configured = this.settings.absyncPath?.trim();
    if (!configured) {
      throw new CliResolutionError("absync CLI path is required.", {
        checked: [],
        configuredPath: null,
        incompatibleError: null,
      });
    }

    const command = this.expandHome(configured);
    const resolved = await this.probeCli(command);
    if (resolved) {
      return resolved;
    }
    throw new CliResolutionError(`Configured absync CLI was not usable: ${command}`, {
      checked: [command],
      configuredPath: command,
      incompatibleError: null,
    });
  }

  private async detectAbsyncCli(): Promise<ResolvedCli> {
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
      throw new CliResolutionError(incompatibleCliError.message, {
        checked: candidates,
        configuredPath: this.settings.absyncPath ? this.expandHome(this.settings.absyncPath) : null,
        incompatibleError: incompatibleCliError.message,
      });
    }

    throw new CliResolutionError("absync CLI was not found.", {
      checked: candidates,
      configuredPath: this.settings.absyncPath ? this.expandHome(this.settings.absyncPath) : null,
      incompatibleError: null,
    });
  }

  private async getCliCandidates(): Promise<string[]> {
    const candidates = [
      "absync",
      "/opt/homebrew/bin/absync",
      "/usr/local/bin/absync",
      path.join(os.homedir(), ".npm-global", "bin", "absync"),
      path.join(os.homedir(), ".local", "bin", "absync"),
    ];
    candidates.unshift(...(await this.resolveCliCandidatesFromShell()));
    candidates.push(...(await this.resolveCliCandidatesFromNpmPrefix()));
    candidates.push(...(await this.resolveCliCandidatesFromNvm()));
    return [...new Set(candidates)];
  }

  private async resolveCliCandidatesFromShell(): Promise<string[]> {
    const result = await this.runProcess(
      "/bin/zsh",
      ["-lc", "command -v absync; npm config get prefix 2>/dev/null"],
      this.getVaultDir(),
      5000,
    );
    if (result.exitCode !== 0) {
      return [];
    }
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.flatMap((line, index) => {
      if (index === 0 && line.endsWith("/absync")) {
        return [line];
      }
      if (line === "undefined" || line === "null") {
        return [];
      }
      return [path.join(line, "bin", "absync")];
    });
  }

  private async resolveCliCandidatesFromNpmPrefix(): Promise<string[]> {
    const npmCandidates = [
      "/opt/homebrew/bin/npm",
      "/usr/local/bin/npm",
    ];
    const results: string[] = [];
    for (const npmCommand of npmCandidates) {
      if (npmCommand.endsWith("node")) {
        continue;
      }
      const result = await this.runProcess(npmCommand, ["config", "get", "prefix"], this.getVaultDir(), 5000);
      if (result.exitCode !== 0) {
        continue;
      }
      const prefix = result.stdout.trim().split(/\r?\n/)[0];
      if (prefix && prefix !== "undefined" && prefix !== "null") {
        results.push(path.join(prefix, "bin", "absync"));
      }
    }
    return results;
  }

  private async resolveCliCandidatesFromNvm(): Promise<string[]> {
    const versionsDir = path.join(os.homedir(), ".nvm", "versions", "node");
    try {
      const entries = await fs.readdir(versionsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(versionsDir, entry.name, "bin", "absync"))
        .sort()
        .reverse();
    } catch {
      return [];
    }
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

  private runProcess(
    command: string,
    args: string[],
    cwd: string,
    optionsOrTimeout: ProcessOptions | number = {},
  ): Promise<SpawnResult> {
    return new Promise((resolve) => {
      const options: ProcessOptions =
        typeof optionsOrTimeout === "number" ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
      const env = this.buildProcessEnv(command);
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

      if ((options.timeoutMs ?? 0) > 0) {
        timeout = setTimeout(() => {
          child.kill();
          finish({ exitCode: null, stdout, stderr: `${stderr}\nTimed out after ${options.timeoutMs}ms.`.trim() });
        }, options.timeoutMs);
      }

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
        options.onStdout?.(chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
        options.onStderr?.(chunk);
      });
      child.on("error", (error) => {
        finish({ exitCode: null, stdout, stderr: error.message });
      });
      child.on("close", (exitCode) => {
        finish({ exitCode, stdout, stderr });
      });
    });
  }

  private buildProcessEnv(command?: string): NodeJS.ProcessEnv {
    const commonPaths = [
      ...(command && path.isAbsolute(command) ? [path.dirname(command)] : []),
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

  private buildCliSetupDetails(failure: CliResolutionFailure | null): string {
    return [
      "Apple Books Notes Sync needs the absync command line tool.",
      "",
      "Install or update it from Terminal:",
      "  npm install -g apple-books-notes-sync",
      "",
      "Find the installed path from Terminal:",
      "  command -v absync",
      "",
      "Then either:",
      "  1. Click Detect in this plugin's settings.",
      "  2. Or paste the command output into absync CLI path.",
      "",
      "The absync CLI path setting is required before Plan, Sync, or Doctor can run.",
      "",
      "Common nvm path example:",
      "  ~/.nvm/versions/node/<version>/bin/absync",
      ...(failure?.configuredPath ? ["", `Configured path: ${failure.configuredPath}`] : []),
      ...(failure?.incompatibleError ? ["", "Version issue:", failure.incompatibleError] : []),
      ...(failure?.checked?.length ? ["", "Checked paths:", ...failure.checked.map((item) => `  ${item}`)] : []),
    ].join("\n");
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
      this.finishStatusBar(`ABS ${result.status === "warning" ? "warning" : "done"}: ${command}`);
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
      this.finishStatusBar(`ABS failed: ${command}`);
      new Notice(`Apple Books Notes Sync: ${command} failed. ${message}`, 30000);
      if (error instanceof CliResolutionError) {
        new CliSetupModal(this.app, `${this.buildCliSetupDetails(error.failure)}\n\n${details}`).open();
      } else {
        new CommandResultModal(this.app, `Apple Books Notes Sync: ${command} failed`, details).open();
      }
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

class CliSetupModal extends Modal {
  constructor(
    app: App,
    private readonly details: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Apple Books Notes Sync: CLI setup" });

    const pre = contentEl.createEl("pre");
    pre.setText(this.details);
    pre.style.whiteSpace = "pre-wrap";
    pre.style.maxHeight = "60vh";
    pre.style.overflow = "auto";

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Copy install command").onClick(() => {
          const clipboard = (navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } }).clipboard;
          void clipboard?.writeText("npm install -g apple-books-notes-sync");
          new Notice("Apple Books Notes Sync: install command copied.", 4000);
        });
      })
      .addButton((button) => {
        button.setButtonText("Copy path command").onClick(() => {
          const clipboard = (navigator as Navigator & { clipboard?: { writeText(text: string): Promise<void> } }).clipboard;
          void clipboard?.writeText("command -v absync");
          new Notice("Apple Books Notes Sync: path command copied.", 4000);
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
      .setDesc("Required full path to absync. Use Detect to find and save it automatically.")
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
      })
      .addButton((button) => {
        button.setButtonText("Detect").onClick(() => {
          void (async () => {
            if (await this.plugin.detectAndSaveAbsyncCli()) {
              this.display();
            }
          })();
        });
      })
      .addButton((button) => {
        button.setButtonText("Test").onClick(() => {
          void this.plugin.testConfiguredAbsyncCli();
        });
      });

    new Setting(containerEl)
      .setName("PDF notes")
      .setDesc("Controls whether PDF annotations are synced and which renderer is used for PDF page images.")
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({
            disabled: "disabled",
            auto: "auto",
            swift: "swift",
            mutool: "MuPDF",
            poppler: "Poppler",
          })
          .setValue(this.plugin.settings.syncPdfNotes ? this.plugin.settings.pdfRenderBackend : "disabled")
          .onChange((value) => {
            void (async () => {
              if (value === "disabled") {
                this.plugin.settings.syncPdfNotes = false;
                this.plugin.settings.pdfRenderBackend = "auto";
              } else {
                this.plugin.settings.syncPdfNotes = true;
                this.plugin.settings.pdfRenderBackend = value as PdfRenderBackend;
              }
              await this.plugin.saveSettings();
            })();
          });
      });
  }
}
