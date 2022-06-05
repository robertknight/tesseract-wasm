import { expose, proxy } from "comlink";

import { createOCREngine } from "./ocr-engine";

type CreateOCREngineOptions = {
  wasmBinary?: Uint8Array | ArrayBuffer;
};

const workerAPI = {
  /**
   * @param progressChannel - Channel to send progress updates over. This is
   *   sent separately from the options argument to enable comlink to transfer it.
   */
  createOCREngine: async (
    { wasmBinary }: CreateOCREngineOptions,
    progressChannel?: MessagePort
  ) => {
    const engine = await createOCREngine({ wasmBinary, progressChannel });
    return proxy(engine);
  },
};
expose(workerAPI);
