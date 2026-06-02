import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  getDefaultPluginSettings,
  normalizePluginSettings,
  pluginSettingsToSyncConfig,
} from "../src/lib/plugin-settings";

test("normalizePluginSettings returns defaults", () => {
  const settings = normalizePluginSettings(null);
  assert.deepEqual(settings, getDefaultPluginSettings());
});

test("normalizePluginSettings accepts plugin settings", () => {
  const settings = normalizePluginSettings({
    managedDirName: "Books",
    syncPdfNotes: false,
    pdfRenderBackend: "swift",
    pdfPageLinkTarget: "chrome",
    absyncPath: " /opt/homebrew/bin/absync ",
  });
  assert.equal(settings.managedDirName, "Books");
  assert.equal(settings.syncPdfNotes, false);
  assert.equal(settings.pdfRenderBackend, "swift");
  assert.equal(settings.pdfPageLinkTarget, "chrome");
  assert.equal(settings.absyncPath, "/opt/homebrew/bin/absync");
});

test("normalizePluginSettings defaults invalid PDF page link target to Edge", () => {
  const settings = normalizePluginSettings({
    pdfPageLinkTarget: "safari" as never,
  });
  assert.equal(settings.pdfPageLinkTarget, "edge");
});

test("normalizePluginSettings migrates legacy pdfBetaEnabled", () => {
  const settings = normalizePluginSettings({
    pdfBetaEnabled: false,
  });
  assert.equal(settings.syncPdfNotes, false);
});

test("pluginSettingsToSyncConfig maps settings to vault scoped sync config", () => {
  const settings = normalizePluginSettings({ managedDirName: "Books" });
  const config = pluginSettingsToSyncConfig("/tmp/Vault", settings);
  assert.equal(config.vaultDir, path.resolve("/tmp/Vault"));
  assert.equal(config.managedDirName, "Books");
  assert.equal(config.syncPdfNotes, true);
  assert.equal(config.pdfRenderBackend, "auto");
  assert.equal(config.pdfPageLinkTarget, "edge");
});
