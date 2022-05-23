import { expose, proxy } from "comlink";

import { createOCREngine } from "./ocr-engine";

const workerAPI = {
  /**
   * @param {object} options
   *   @param {Uint8Array|ArrayBuffer} [options.wasmBinary]
   */
  createOCREngine: async ({ wasmBinary }) => {
    const engine = await createOCREngine({ wasmBinary });
    return proxy(engine);
  },
};
expose(workerAPI);
