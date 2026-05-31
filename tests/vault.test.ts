import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type VaultModule = typeof import("../src/lib/vault");

async function withTempObsidianHome<T>(run: (vault: VaultModule, homeDir: string) => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "apple-books-vault-"));
  process.env.HOME = homeDir;
  try {
    const vault = (await import(`../src/lib/vault?home=${Date.now()}-${Math.random()}`)) as VaultModule;
    return await run(vault, homeDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

async function createVault(homeDir: string, id: string, name: string, enabled = true): Promise<string> {
  const vaultDir = path.join(homeDir, "vaults", name);
  await fs.mkdir(path.join(vaultDir, ".obsidian", "plugins", "apple-books-notes-sync"), { recursive: true });
  await fs.writeFile(
    path.join(vaultDir, ".obsidian", "plugins", "apple-books-notes-sync", "manifest.json"),
    "{}",
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultDir, ".obsidian", "community-plugins.json"),
    JSON.stringify(enabled ? ["apple-books-notes-sync"] : []),
    "utf8",
  );
  const obsidianDir = path.join(homeDir, "Library", "Application Support", "obsidian");
  await fs.mkdir(obsidianDir, { recursive: true });
  let data = { vaults: {} as Record<string, { path: string; open: boolean }> };
  try {
    data = JSON.parse(await fs.readFile(path.join(obsidianDir, "obsidian.json"), "utf8")) as typeof data;
  } catch {
    // created below
  }
  data.vaults[id] = { path: vaultDir, open: true };
  await fs.writeFile(path.join(obsidianDir, "obsidian.json"), JSON.stringify(data), "utf8");
  return vaultDir;
}

test("resolveVault matches id before name and path", async () => {
  await withTempObsidianHome(async (vault, homeDir) => {
    await createVault(homeDir, "vault-id", "ReadableName");
    const resolved = await vault.resolveVault("vault-id");
    assert.equal(resolved.id, "vault-id");
    assert.equal(resolved.name, "ReadableName");
  });
});

test("resolveVault matches unique vault name", async () => {
  await withTempObsidianHome(async (vault, homeDir) => {
    await createVault(homeDir, "a", "Notes");
    const resolved = await vault.resolveVault("Notes");
    assert.equal(resolved.id, "a");
  });
});

test("resolveVault rejects duplicate vault names before path fallback", async () => {
  await withTempObsidianHome(async (vault, homeDir) => {
    await createVault(homeDir, "a", "Work");
    const second = await createVault(homeDir, "b", path.join("other", "Work"));
    await assert.rejects(() => vault.resolveVault("Work"), /Multiple vaults named "Work"/);
    assert.ok(second.endsWith(path.join("other", "Work")));
  });
});

test("resolveVault uses current directory containing a vault", async () => {
  await withTempObsidianHome(async (vault, homeDir) => {
    const vaultDir = await createVault(homeDir, "a", "Daily");
    const child = path.join(vaultDir, "folder");
    await fs.mkdir(child);
    const resolved = await vault.resolveVault(undefined, child);
    assert.equal(resolved.path, vaultDir);
  });
});

test("resolveVault rejects disabled plugin", async () => {
  await withTempObsidianHome(async (vault, homeDir) => {
    await createVault(homeDir, "a", "Disabled", false);
    await assert.rejects(() => vault.resolveVault("Disabled"), /not enabled/);
  });
});
