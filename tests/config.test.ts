import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type ConfigModule = typeof import("../src/lib/config");

async function withTempHome<T>(run: (config: ConfigModule, homeDir: string) => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-config-"));
  process.env.HOME = homeDir;

  try {
    const config = (await import(`../src/lib/config?home=${Date.now()}-${Math.random()}`)) as ConfigModule;
    return await run(config, homeDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

test("migrateLegacyConfigIfNeeded copies old config to Application Support", async () => {
  await withTempHome(async (config, homeDir) => {
    const legacyConfigPath = path.join(homeDir, ".config", "ibooks-notes-sync", "config.json");
    await fs.mkdir(path.dirname(legacyConfigPath), { recursive: true });
    await fs.writeFile(
      legacyConfigPath,
      JSON.stringify(
        {
          outputDir: "~/Notes",
          managedDirName: "sync",
          pdfBetaEnabled: false,
          pdfRenderBackend: "swift",
        },
        null,
        2,
      ),
      "utf8",
    );

    assert.equal(await config.migrateLegacyConfigIfNeeded(), true);
    assert.equal(await config.configExists(), true);

    const migrated = await config.readConfig();
    assert.equal(migrated.outputDir, path.join(homeDir, "Notes"));
    assert.equal(migrated.managedDirName, "sync");
    assert.equal(migrated.pdfBetaEnabled, false);
    assert.equal(migrated.pdfRenderBackend, "swift");
  });
});

test("migrateLegacyConfigIfNeeded does not overwrite an existing new config", async () => {
  await withTempHome(async (config, homeDir) => {
    await config.writeConfig({
      outputDir: path.join(homeDir, "Current"),
      managedDirName: "current",
      pdfBetaEnabled: true,
      pdfRenderBackend: "auto",
    });

    const legacyConfigPath = path.join(homeDir, ".config", "ibooks-notes-sync", "config.json");
    await fs.mkdir(path.dirname(legacyConfigPath), { recursive: true });
    await fs.writeFile(
      legacyConfigPath,
      JSON.stringify({
        outputDir: path.join(homeDir, "Legacy"),
        managedDirName: "legacy",
      }),
      "utf8",
    );

    assert.equal(await config.migrateLegacyConfigIfNeeded(), false);

    const current = await config.readConfig();
    assert.equal(current.outputDir, path.join(homeDir, "Current"));
    assert.equal(current.managedDirName, "current");
  });
});
