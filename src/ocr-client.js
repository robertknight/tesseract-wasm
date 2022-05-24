import * as comlink from "comlink";

/**
 * @typedef {import('./ocr-engine').BoxItem} BoxItem
 * @typedef {import('./ocr-engine').TextItem} TextItem
 * @typedef {import('./ocr-engine').TextUnit} TextUnit
 */

function defaultWorkerURL() {
  return new URL("./tesseract-worker.js", import.meta.url).href;
}

/**
 * @param {string} url
 */
function initWebWorker(url) {
  const worker = new Worker(url);
  const remote = comlink.wrap(worker);
  return { remote, terminate: () => worker.terminate };
}

/**
 * @typedef OCRClientWorker
 * @prop {import('comlink').Remote<any>} remote
 * @prop {() => void} terminate
 */

/**
 * High-level async API for performing OCR.
 */
export class OCRClient {
  /**
   * Initialize an OCR engine.
   *
   * This will start a Web Worker in which the OCR operations will actually
   * be performed.
   *
   * @param {object} options
   *   @param {(url: string) => OCRClientWorker} [options.initWorker] - Internal
   *     callback that initializes a worker in the current environment. The
   *     default implementation sets up a Web Worker.
   *   @param {Uint8Array|ArrayBuffer} [options.wasmBinary] - WebAssembly binary
   *     to load in worker. If not set, it is loaded from the default location
   *     relative to the currnet script.
   *   @param {string} [options.workerURL] - Location of worker script/module.
   *     If not set, it is loaded from the default location relative to the
   *     current script.
   */
  constructor({
    initWorker = initWebWorker,
    wasmBinary,
    workerURL = defaultWorkerURL(),
  } = {}) {
    const { remote, terminate } = initWorker(workerURL);
    this._terminate = terminate;
    this._ocrEngine = remote.createOCREngine({ wasmBinary });
  }

  async destroy() {
    this._terminate();
  }

  /**
   * Load a trained model for a specific language. This can be specified either
   * as a URL to fetch or a buffer containing an already-loaded model.
   *
   * @param {string|ArrayBuffer} model
   */
  async loadModel(model) {
    const engine = await this._ocrEngine;
    if (typeof model === "string") {
      const response = await fetch(model);
      model = await response.arrayBuffer();
    }
    return engine.loadModel(model);
  }

  /**
   * Load an image into the OCR engine for processing.
   *
   * @param {ImageBitmap|ImageData} image
   */
  async loadImage(image) {
    // If the browser doesn't support OffscreenCanvas, we have to perform
    // ImageBitmap => ImageData conversion on the main thread.
    if (
      typeof ImageBitmap !== "undefined" &&
      image instanceof ImageBitmap &&
      // @ts-expect-error - OffscreenCanvas is missing from TS types
      typeof OffscreenCanvas === "undefined"
    ) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = /** @type {CanvasRenderingContext2D} */ (
        canvas.getContext("2d")
      );
      context.drawImage(image, 0, 0, image.width, image.height);
      image = context.getImageData(0, 0, image.width, image.height);
    }
    const engine = await this._ocrEngine;
    return engine.loadImage(image);
  }

  /**
   * Perform layout analysis on the current image, if not already done, and
   * return bounding boxes for a given unit of text.
   *
   * This operation is relatively cheap compared to text recognition, so can
   * provide much faster results if only the location of lines/words etc. on
   * the page is required, not the text content.
   *
   * @param {TextUnit} unit
   * @return {Promise<BoxItem[]>}
   */
  async getBoundingBoxes(unit) {
    const engine = await this._ocrEngine;
    return engine.getBoundingBoxes(unit);
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return bounding boxes and text content for a given
   * unit of text.
   *
   * @param {TextUnit} unit
   * @return {Promise<TextItem[]>}
   */
  async getTextBoxes(unit) {
    const engine = await this._ocrEngine;
    return engine.getTextBoxes(unit);
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return the image's text as a string.
   *
   * @return {Promise<string>}
   */
  async getText() {
    const engine = await this._ocrEngine;
    return engine.getText();
  }
}
