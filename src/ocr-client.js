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

/** @typedef {(progress: number) => void} ProgressListener */

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

    /** @type {ProgressListener[]} progress */
    this._progressListeners = [];

    const endpoint =
      "addEventListener" in worker ? worker : nodeEndpoint(worker);
    const remote = comlink.wrap(endpoint);

    // Create a channel for the worker to send us progress updates during
    // operations. We use a separate channel instead of following comlink's
    // recommended recipe for callback arguments for two reasons:
    //
    // 1. If using `comlink.proxy(callback)`, event listeners get added to the
    //    MessagePort each time the callback is invoked and removed when the
    //    MessagePort receives a "message" response. If the callback is triggered
    //    many times in one event loop turn, this will trigger warnings from
    //    Node about having too many listeners. It is also quite inefficient.
    //
    // 2. Firefox has an issue where messages sent on a newly received port are
    //    not dispatched until the next event loop turn. This means that we
    //    need to send the port to the worker ahead of time.
    //    I think https://bugzilla.mozilla.org/show_bug.cgi?id=1752287 is
    //    relevant.
    const { port1, port2 } = new MessageChannel();
    this._progressChannel = port1;
    this._progressChannel.onmessage = (e) => {
      // We ought to have some mechanism to dispatch an update only to
      // applicable listeners. In typical usage there will only be one expensive
      // operation happening at a time for an OCRClient instance (OCR of the
      // currently loaded image), so we can get away with just notifying all
      // registered listeners.
      const { progress } = e.data;
      for (let listener of this._progressListeners) {
        listener(progress);
      }
    };

    this._ocrEngine = remote.createOCREngine(
      {
        wasmBinary,
      },
      comlink.transfer(port2, [port2])
    );
  }

  async destroy() {
    this._worker.terminate();
    this._progressChannel.close();
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
   * @param {ProgressListener} [onProgress]
   * @return {Promise<TextItem[]>}
   */
  async getTextBoxes(unit, onProgress) {
    const engine = await this._ocrEngine;

    if (onProgress) {
      this._addProgressListener(onProgress);
    }
    try {
      return await engine.getTextBoxes(unit);
    } finally {
      if (onProgress) {
        this._removeProgressListener(onProgress);
      }
    }
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return the image's text as a string.
   *
   * @param {ProgressListener} [onProgress]
   * @return {Promise<string>}
   */
  async getText(onProgress) {
    const engine = await this._ocrEngine;
    if (onProgress) {
      this._addProgressListener(onProgress);
    }
    try {
      return await engine.getText();
    } finally {
      if (onProgress) {
        this._removeProgressListener(onProgress);
      }
    }
  }

  /** @param {ProgressListener} listener */
  _addProgressListener(listener) {
    this._progressListeners.push(listener);
  }

  /** @param {ProgressListener} listener */
  _removeProgressListener(listener) {
    this._progressListeners = this._progressListeners.filter(
      (l) => l !== listener
    );
  }
}
