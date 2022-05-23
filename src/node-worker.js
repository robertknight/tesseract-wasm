import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

import { expose, proxy, wrap } from "comlink";

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

/**
 * @param {string|URL} url
 */
function initNodeWorker(url) {
  const worker = new Worker(new URL(url));
  const remote = wrap(nodeEndpoint(worker));
  return { remote, terminate: () => worker.terminate() };
}

export function createOCRClient(options = {}) {
  return new OCRClient({
    initWorker: initNodeWorker,
    workerURL: new URL(import.meta.url).href,
    ...options,
  });
}

if (!isMainThread) {
  const workerAPI = {
    /**
     * @param {object} options
     *   @param {Uint8Array|ArrayBuffer} [options.wasmBinary]
     */
    createOCREngine: async ({ wasmBinary }) => {
      if (!wasmBinary) {
        wasmBinary = await readFile(resolve("../dist/tesseract-core.wasm"));
      }
      const engine = await createOCREngine({ wasmBinary });
      return proxy(engine);
    },
  };
  expose(workerAPI, nodeEndpoint(parentPort));
}
