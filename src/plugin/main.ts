import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { runDoctor } from "../lib/doctor";
import { resolveIbooksPaths } from "../lib/ibooks-paths";
import {
  getDefaultPluginSettings,
  normalizePluginSettings,
  pluginSettingsToSyncConfig,
  type PluginSettings,
} from "../lib/plugin-settings";
import { applyRuntimeCommands } from "../lib/runtime-config";
import { buildSyncPlan, runSync } from "../lib/sync";
import type { PdfRenderBackend } from "../lib/types";

export default class AppleBooksNotesSyncPlugin extends Plugin {
  settings: PluginSettings = getDefaultPluginSettings();

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
    new Notice("Apple Books Notes Sync: previewing sync plan...", 4000);
    try {
      const config = this.getSyncConfig();
      const plan = await buildSyncPlan(config, await resolveIbooksPaths(), {});
      new Notice(
        `Apple Books plan: ${plan.stats.changedBooks} changed, ${plan.stats.unchangedBooks} unchanged, ${plan.stats.removedBooks} removed.`,
        10000,
      );
    } catch (error: unknown) {
      this.reportError("Preview sync plan failed", error);
    }
  }

  private async runSyncCommand(dryRun: boolean): Promise<void> {
    new Notice("Apple Books Notes Sync: syncing Apple Books notes...", 4000);
    try {
      const result = await runSync(this.getSyncConfig(), await resolveIbooksPaths(), { dryRun });
      new Notice(
        `Apple Books sync: ${result.stats.successBooks} success, ${result.stats.failedBooks} failed, ${result.stats.generatedFiles} files. Output: ${result.outputDir}`,
        result.stats.failedBooks > 0 ? 15000 : 10000,
      );
    } catch (error: unknown) {
      this.reportError("Sync Apple Books notes failed", error);
    }
  }

  private async runDoctorCommand(): Promise<void> {
    new Notice("Apple Books Notes Sync: running doctor...", 4000);
    try {
      const report = await runDoctor(await resolveIbooksPaths(), this.getSyncConfig(), null);
      const failed = report.checks.filter((check) => !check.ok);
      new Notice(
        failed.length === 0
          ? `Apple Books doctor passed. Syncable books: ${report.summary.books}.`
          : `Apple Books doctor found ${failed.length} issue(s). First: ${failed[0]?.name}: ${failed[0]?.detail}`,
        failed.length === 0 ? 10000 : 15000,
      );
    } catch (error: unknown) {
      this.reportError("Run doctor failed", error);
    }
  }

  private reportError(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Apple Books Notes Sync] ${action}`, error);
    new Notice(`Apple Books Notes Sync: ${action}. ${message}`, 20000);
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
