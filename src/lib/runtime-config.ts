import path from "node:path";
import { setPdfCommands } from "./pdf";
import { getPluginDir } from "./plugin-settings";
import { setSqliteCommand } from "./sqlite";
import type { SyncConfig } from "./types";

export function applyRuntimeCommands(config: SyncConfig): void {
  setSqliteCommand(config.commands.sqlite3);
  setPdfCommands({
    swift: config.commands.swift,
    mutool: config.commands.mutool,
    pdftocairo: config.commands.pdftocairo,
    swiftRenderScriptPath: path.join(getPluginDir(config.vaultDir), "tools", "render_pdf_page.swift"),
  });
}
