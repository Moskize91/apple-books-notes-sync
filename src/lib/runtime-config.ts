import path from "node:path";
import { setPdfCommands } from "./pdf";
import { getPluginDir } from "./plugin-settings";
import type { SyncConfig } from "./types";

export function applyRuntimeCommands(config: SyncConfig): void {
  setPdfCommands({
    swiftRenderScriptPath: path.join(getPluginDir(config.vaultDir), "tools", "render_pdf_page.swift"),
  });
}
