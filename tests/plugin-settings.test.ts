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

test("normalizePluginSettings accepts command overrides", () => {
  const settings = normalizePluginSettings({
    managedDirName: "Books",
    pdfBetaEnabled: false,
    pdfRenderBackend: "swift",
    commands: {
      sqlite3: "/opt/bin/sqlite3",
      mutool: "/opt/bin/mutool",
    },
  });
  assert.equal(settings.managedDirName, "Books");
  assert.equal(settings.pdfBetaEnabled, false);
  assert.equal(settings.pdfRenderBackend, "swift");
  assert.equal(settings.commands.sqlite3, "/opt/bin/sqlite3");
  assert.equal(settings.commands.mutool, "/opt/bin/mutool");
  assert.equal(settings.commands.swift, "swift");
});

test("pluginSettingsToSyncConfig maps settings to vault scoped sync config", () => {
  const settings = normalizePluginSettings({ managedDirName: "Books" });
  const config = pluginSettingsToSyncConfig("/tmp/Vault", settings);
  assert.equal(config.vaultDir, path.resolve("/tmp/Vault"));
  assert.equal(config.managedDirName, "Books");
  assert.equal(config.commands.sqlite3, "sqlite3");
});
