import { copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const BUNDLE = "scripts/main.js";

/** Copies static module files into dist/ and points module.json at the bundle. */
function foundryModuleFiles() {
  return {
    name: "foundry-module-files",
    writeBundle(options) {
      const outDir = options.dir;
      const manifest = JSON.parse(readFileSync("module.json", "utf8"));
      manifest.esmodules = [BUNDLE];
      writeFileSync(resolve(outDir, "module.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      cpSync("lang", resolve(outDir, "lang"), { recursive: true });
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
