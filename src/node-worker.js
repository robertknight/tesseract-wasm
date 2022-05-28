import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

import { expose, proxy } from "comlink";

// @ts-ignore
import nodeEndpoint from "comlink/dist/esm/node-adapter.mjs";

import { createOCREngine, OCRClient } from "../dist/lib.js";

/**
 * Resolve a path against the location of the current module.
 *
 * @param {string} path
 */
export function resolve(path, moduleURL = import.meta.url) {
  return fileURLToPath(new URL(path, moduleURL).href);
}

export function createOCRClient(options = {}) {
  return new OCRClient({
    createWorker: (url) => new Worker(new URL(url)),
    workerURL: new URL(import.meta.url).href,
    ...options,
  });
}

if (!isMainThread) {
  const workerAPI = {
    /**
     * @param {object} options
     *   @param {Uint8Array|ArrayBuffer} [options.wasmBinary]
     * @param {MessagePort} [progressChannel]
     */
    createOCREngine: async ({ wasmBinary }, progressChannel) => {
      if (!wasmBinary) {
        wasmBinary = await readFile(resolve("../dist/tesseract-core.wasm"));
      }
      const engine = await createOCREngine({ wasmBinary, progressChannel });
      return proxy(engine);
    },
  };
  expose(workerAPI, nodeEndpoint(parentPort));
}
