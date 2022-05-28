import { expose, proxy } from "comlink";

import { createOCREngine } from "./ocr-engine";

const workerAPI = {
  /**
   * @param {object} options
   *   @param {Uint8Array|ArrayBuffer} [options.wasmBinary]
   * @param {MessagePort} [progressChannel] - Channel to send progress updates
   *   over. This is sent separately from the options argument to enable
   *   comlink to transfer it.
   */
  createOCREngine: async ({ wasmBinary }, progressChannel) => {
    const engine = await createOCREngine({ wasmBinary, progressChannel });
    return proxy(engine);
  },
};
expose(workerAPI);
