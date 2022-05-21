import * as comlink from "comlink";

/**
 * @typedef {import('./ocr-engine').IntRect} IntRect
 * @typedef {import('./ocr-engine').TextRect} TextRect
 * @typedef {import('./ocr-engine').TextUnit} TextUnit
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
   */
  constructor() {
    // We load the non-module version of the library into the worker, because
    // Firefox and Safari < 15 do not support modules in web workers.
    const workerURL = new URL("./worker.js", import.meta.url);
    this._worker = new Worker(workerURL);
    const workerAPI = comlink.wrap(this._worker);
    this._ocrEngine = workerAPI.createOCREngine();
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
   * @return {Promise<IntRect[]>}
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
   * @return {Promise<TextRect[]>}
   */
  async getTextBoxes(unit) {
    const engine = await this._ocrEngine;
    return engine.getTextBoxes(unit);
  }
}
