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

test("getConfigPath uses macOS Application Support", async () => {
  await withTempHome(async (config, homeDir) => {
    assert.equal(
      config.getConfigPath(),
      path.join(homeDir, "Library", "Application Support", "apple-books-notes-sync", "config.json"),
    );
  });
});

test("readConfigOrDefault returns defaults when config is missing", async () => {
  await withTempHome(async (config) => {
    const loaded = await config.readConfigOrDefault();
    assert.equal(loaded.outputDir, null);
    assert.equal(loaded.managedDirName, "Apple Books Notes");
    assert.equal(loaded.pdfBetaEnabled, true);
    assert.equal(loaded.pdfRenderBackend, "auto");
  });
});

test("writeConfig persists normalized config", async () => {
  await withTempHome(async (config, homeDir) => {
    await config.writeConfig({
      outputDir: path.join(homeDir, "Notes"),
      managedDirName: "Apple Books",
      pdfBetaEnabled: false,
      pdfRenderBackend: "swift",
    });

    assert.equal(await config.configExists(), true);
    const loaded = await config.readConfig();
    assert.equal(loaded.outputDir, path.join(homeDir, "Notes"));
    assert.equal(loaded.managedDirName, "Apple Books");
    assert.equal(loaded.pdfBetaEnabled, false);
    assert.equal(loaded.pdfRenderBackend, "swift");
  });
});

test("normalizeConfig expands home and falls back for invalid pdf renderer", async () => {
  await withTempHome(async (config, homeDir) => {
    const normalized = config.normalizeConfig({
      outputDir: "~/Notes",
      pdfRenderBackend: "invalid" as never,
    });
    assert.equal(normalized.outputDir, path.join(homeDir, "Notes"));
    assert.equal(normalized.managedDirName, "Apple Books Notes");
    assert.equal(normalized.pdfBetaEnabled, true);
    assert.equal(normalized.pdfRenderBackend, "auto");
  });
});

test("loadValidatedConfig reports missing output dir with setup guidance", async () => {
  await withTempHome(async (config) => {
    await assert.rejects(
      () => config.loadValidatedConfig(),
      (error: unknown) => {
        assert.ok(error instanceof config.ConfigValidationError);
        assert.match(error.message, /Missing required config: output\.dir/);
        assert.match(error.message, /absync config set output\.dir/);
        return true;
      },
    );
  });
});

test("validateConfig requires output dir to be an Obsidian vault", async () => {
  await withTempHome(async (config, homeDir) => {
    const notVault = path.join(homeDir, "NotVault");
    await fs.mkdir(notVault, { recursive: true });

    await assert.rejects(
      () =>
        config.validateConfig({
          outputDir: notVault,
          managedDirName: "Apple Books Notes",
          pdfBetaEnabled: true,
          pdfRenderBackend: "auto",
        }),
      (error: unknown) => {
        assert.ok(error instanceof config.ConfigValidationError);
        assert.match(error.message, /not an Obsidian vault/);
        assert.match(error.message, /\.obsidian\//);
        assert.match(error.message, /absync config set output\.dir/);
        return true;
      },
    );
  });
});

test("validateConfig accepts an existing Obsidian vault", async () => {
  await withTempHome(async (config, homeDir) => {
    const vault = path.join(homeDir, "Vault");
    await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });

    await config.validateConfig({
      outputDir: vault,
      managedDirName: "Apple Books Notes",
      pdfBetaEnabled: true,
      pdfRenderBackend: "auto",
    });
  });
});
