import * as comlink from "comlink";

// Although this import is Node-specific, it is tiny and doesn't import any
// Node libs, so can be included in a bundle that runs in non-Node environments.
//
// @ts-ignore
import nodeEndpoint from "comlink/dist/esm/node-adapter.mjs";

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
function createWebWorker(url) {
  return new Worker(url);
}

/**
 * Create a channel to receive progress updates from a Worker and relay them
 * to a callback.
 *
 * This channel is used rather than comlink's recommended approach to callbacks
 * (see https://github.com/GoogleChromeLabs/comlink#callbacks) because that is
 * prone to triggering warnings in Node about too many event listeners being
 * added to a MessagePort, due to the way comlink internally adds and removes
 * listeners when the proxied callback is invoked.
 *
 * @param {(progress: number) => void} onProgress
 */
function createProgressChannel(onProgress) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = (event) => {
    const { progress } = event.data;
    onProgress(progress);
  };
  return comlink.transfer(port2, [port2]);
}

/**
 * High-level async API for performing OCR.
 *
 * In the browser, this class can be constructed directly. In Node, use the
 * `createOCRClient` helper from `node-worker.js`.
 */
export class OCRClient {
  /**
   * Initialize an OCR engine.
   *
   * This will start a Worker in which the OCR operations will actually be
   * performed.
   *
   * @param {object} options
   *   @param {(url: string) => Worker} [options.createWorker] - Callback that
   *     creates the worker. The default implementation creates a Web Worker.
   *   @param {Uint8Array|ArrayBuffer} [options.wasmBinary] - WebAssembly binary
   *     to load in worker. If not set, it is loaded from the default location
   *     relative to the current script.
   *   @param {string} [options.workerURL] - Location of worker script/module.
   *     If not set, it is loaded from the default location relative to the
   *     current script.
   */
  constructor({
    createWorker = createWebWorker,
    wasmBinary,
    workerURL = defaultWorkerURL(),
  } = {}) {
    const worker = createWorker(workerURL);
    this._worker = worker;

    const endpoint =
      "addEventListener" in worker ? worker : nodeEndpoint(worker);
    const remote = comlink.wrap(endpoint);

    this._ocrEngine = remote.createOCREngine({ wasmBinary });
  }

  async destroy() {
    this._worker.terminate();
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
   * @param {(progress: number) => void} [onProgress]
   * @return {Promise<TextItem[]>}
   */
  async getTextBoxes(unit, onProgress) {
    const engine = await this._ocrEngine;
    const progressChannel = onProgress
      ? createProgressChannel(onProgress)
      : undefined;
    const result = await engine.getTextBoxes(unit, progressChannel);
    progressChannel?.close();
    return result;
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return the image's text as a string.
   *
   * @param {(progress: number) => void} [onProgress]
   * @return {Promise<string>}
   */
  async getText(onProgress) {
    const engine = await this._ocrEngine;
    const progressChannel = onProgress
      ? createProgressChannel(onProgress)
      : undefined;
    const result = await engine.getText(progressChannel);
    progressChannel?.close();
    return result;
  }
}
