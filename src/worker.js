import { expose, proxy } from "comlink";

import { createOCREngine } from "./ocr-engine";
if (typeof WorkerGlobalScope !== "undefined") {
  const workerAPI = {
    createOCREngine: async () => {
      const engine = await createOCREngine();
      return proxy(engine);
    },
  };
  expose(workerAPI);
}
