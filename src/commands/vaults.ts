import type { Command } from "commander";
import { discoverObsidianVaults } from "../lib/vault";
import { printCommandError } from "./context";

type VaultsOptions = {
  json?: boolean;
};

export function registerVaultsCommand(program: Command): void {
  program
    .command("vaults")
    .description("List discovered Obsidian vaults")
    .addHelpCommand(false)
    .showHelpAfterError("(run `absync vaults --help` for usage)")
    .option("--json", "print machine-readable JSON output")
    .action((options: VaultsOptions) => {
      void (async () => {
        const vaults = await discoverObsidianVaults();
        if (options.json) {
          console.log(JSON.stringify(vaults, null, 2));
          return;
        }
        if (vaults.length === 0) {
          console.log("No Obsidian vaults found.");
          return;
        }
        console.log("Name\tOpen\tPlugin\tID\tPath");
        for (const vault of vaults) {
          const plugin = vault.pluginEnabled ? "enabled" : vault.pluginInstalled ? "installed" : "missing";
          console.log(`${vault.name}\t${vault.open ? "yes" : "no"}\t${plugin}\t${vault.id}\t${vault.path}`);
        }
      })().catch((error: unknown) => {
        printCommandError(error, "vaults failed");
      });
    });
}
