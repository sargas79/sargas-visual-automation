import { copyFileSync, cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const BUNDLE = "scripts/main.js";
/** Runtime folders shipped as-is next to the bundle. */
const STATIC_DIRS = ["lang", "rules", "templates", "styles", "packs"];

/** Copies static module files into dist/ and points module.json at the bundle. */
function foundryModuleFiles() {
  return {
    name: "foundry-module-files",
    writeBundle(options) {
      const outDir = options.dir;
      const manifest = JSON.parse(readFileSync("module.json", "utf8"));
      manifest.esmodules = [BUNDLE];
      writeFileSync(resolve(outDir, "module.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      for (const dir of STATIC_DIRS) {
        if (existsSync(dir)) cpSync(dir, resolve(outDir, dir), { recursive: true });
      }
      for (const file of ["README.md", "LICENSE"]) {
        try {
          copyFileSync(file, resolve(outDir, file));
        } catch {
          // optional file
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => ({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: mode === "development",
    minify: mode !== "development",
    lib: {
      entry: "src/main.js",
      formats: ["es"],
      fileName: () => BUNDLE
    }
  },
  plugins: [foundryModuleFiles()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup/foundry-mock.js"]
  }
}));
