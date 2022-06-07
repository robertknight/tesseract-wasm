import { cpSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// List of files which tesseract-wasm expects to be served alongside the JS
// bundle, if using its default asset location settings.
const files = [
  "tesseract-core.wasm", // Main OCR engine module
  "tesseract-core-fallback.wasm", // Slower version for browsers without SIMD support
  "tesseract-worker.js", // JS entry point for the web worker
];

for (let file of files) {
  const rootDir = dirname(fileURLToPath(import.meta.url));
  cpSync(
    `${rootDir}/node_modules/tesseract-wasm/dist/${file}`,
    `${rootDir}/build/${file}`
  );
}
