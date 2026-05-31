import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: {
    main: "src/plugin/main.ts",
  },
  external: ["obsidian"],
  skipNodeModulesBundle: true,
  format: ["cjs"],
  outDir: "plugin-dist",
  sourcemap: true,
  splitting: false,
  target: "node20",
});
