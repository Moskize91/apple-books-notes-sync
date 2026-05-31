import fs from "node:fs/promises";
import path from "node:path";
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { runDoctor } from "../lib/doctor";
import { resolveIbooksPaths } from "../lib/ibooks-paths";
import { setLogHandler } from "../lib/logger";
import {
  getPluginDir,
  getDefaultPluginSettings,
  normalizePluginSettings,
  pluginSettingsToSyncConfig,
  type PluginSettings,
} from "../lib/plugin-settings";
import { applyRuntimeCommands } from "../lib/runtime-config";
import { buildSyncPlan, runSync, type SyncPlan, type SyncPlanBook, type SyncPlanRemovedBook } from "../lib/sync";
import type { LogLevel, PdfRenderBackend } from "../lib/types";

type PluginCommandResult = {
  status: "success" | "warning";
  notice: string;
  details: string;
};

export default class AppleBooksNotesSyncPlugin extends Plugin {
  settings: PluginSettings = getDefaultPluginSettings();
  private commandRunning = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AppleBooksNotesSyncSettingTab(this.app, this));

    this.addCommand({
      id: "sync",
      name: "Run absync sync",
      callback: () => {
        void this.runSyncCommand(false);
      },
    });
    this.addCommand({
      id: "preview-sync-plan",
      name: "Run absync plan",
      callback: () => {
        void this.previewPlan();
      },
    });
    this.addCommand({
      id: "doctor",
      name: "Run absync doctor",
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
    const config = pluginSettingsToSyncConfig(this.getVaultDir(), this.settings);
    applyRuntimeCommands(config);
    return config;
  }

  private async previewPlan(): Promise<void> {
    await this.runVisibleCommand("absync plan", async () => {
      const config = this.getSyncConfig();
      const plan = await buildSyncPlan(config, await resolveIbooksPaths(), {});
      return {
        status: "success",
        notice: `${plan.stats.changedBooks} changed, ${plan.stats.unchangedBooks} unchanged, ${plan.stats.removedBooks} removed.`,
        details: this.formatPlan(plan),
      };
    });
  }

  private async runSyncCommand(dryRun: boolean): Promise<void> {
    await this.runVisibleCommand(dryRun ? "absync sync --dry-run" : "absync sync", async () => {
      const result = await runSync(this.getSyncConfig(), await resolveIbooksPaths(), { dryRun });
      return {
        status: result.stats.failedBooks > 0 ? "warning" : "success",
        notice: `${result.stats.successBooks} success, ${result.stats.failedBooks} failed, ${result.stats.generatedFiles} files.`,
        details: [
          `Command: ${dryRun ? "absync sync --dry-run" : "absync sync"}`,
          `Output: ${result.outputDir}`,
          "",
          `Summary: total=${result.stats.totalBooks}, success=${result.stats.successBooks}, failed=${result.stats.failedBooks}, skipped=${result.stats.skippedBooks}, files=${result.stats.generatedFiles}`,
        ].join("\n"),
      };
    });
  }

  private async runDoctorCommand(): Promise<void> {
    await this.runVisibleCommand("absync doctor", async () => {
      const report = await runDoctor(await resolveIbooksPaths(), this.getSyncConfig(), null);
      const failed = report.checks.filter((check) => !check.ok);
      return {
        status: failed.length === 0 ? "success" : "warning",
        notice:
          failed.length === 0
            ? `passed. Syncable books: ${report.summary.books}.`
            : `found ${failed.length} issue(s). First: ${failed[0]?.name}: ${failed[0]?.detail}`,
        details: [
          "Command: absync doctor",
          "",
          ...report.checks.map((check) => `[${check.ok ? "PASS" : "FAIL"}] ${check.name} - ${check.detail}`),
          "",
          `Summary: syncable=${report.summary.books}, epub=${report.summary.epubBooks}, pdf=${report.summary.pdfBooks}, unsupported=${report.summary.unsupportedBooks}`,
        ].join("\n"),
      };
    });
  }

  private async runVisibleCommand(command: string, action: () => Promise<PluginCommandResult>): Promise<void> {
    if (this.commandRunning) {
      new Notice("Apple Books Notes Sync: another absync command is still running.", 8000);
      return;
    }

    this.commandRunning = true;
    new Notice(`Apple Books Notes Sync: running ${command}...`, 4000);

    const lines: string[] = [`Command: ${command}`, `Started: ${new Date().toISOString()}`, ""];
    const restoreLogHandler = setLogHandler((level: LogLevel, message: string) => {
      const line = `[${level.toUpperCase()}] ${message}`;
      lines.push(line);
      this.writeConsoleLog(level, line);
    });

    try {
      const result = await action();
      lines.push("", result.details);
      const logPath = await this.safeWriteCommandLog(command, lines.join("\n"));
      const title = `Apple Books Notes Sync: ${command}`;
      const details = `${lines.join("\n")}\n\nLog file: ${logPath}`;
      new Notice(`Apple Books Notes Sync: ${command} ${result.notice}`, result.status === "warning" ? 20000 : 10000);
      new CommandResultModal(this.app, title, details).open();
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
      restoreLogHandler();
      this.commandRunning = false;
    }
  }

  private writeConsoleLog(level: LogLevel, line: string): void {
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
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

  private formatPlan(plan: SyncPlan): string {
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
      `Summary: total=${plan.stats.totalBooks}, changed=${plan.stats.changedBooks}, unchanged=${plan.stats.unchangedBooks}, removed=${plan.stats.removedBooks}`,
    ].join("\n");
  }

  private formatPlanItems(items: Array<SyncPlanBook | SyncPlanRemovedBook>): string[] {
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

    new Setting(containerEl).setName("External commands").setHeading();
    this.addCommandSetting("sqlite3", "sqlite3");
    this.addCommandSetting("swift", "swift");
    this.addCommandSetting("mutool", "mutool");
    this.addCommandSetting("pdftocairo", "pdftocairo");
  }

  private addCommandSetting(key: keyof PluginSettings["commands"], label: string): void {
    new Setting(this.containerEl)
      .setName(label)
      .setDesc(`Command or absolute path for ${label}.`)
      .addText((text) => {
        text.setValue(this.plugin.settings.commands[key]).onChange((value) => {
          void (async () => {
            this.plugin.settings.commands[key] = value.trim() || getDefaultPluginSettings().commands[key];
            await this.plugin.saveSettings();
          })();
        });
      });
  }
}
