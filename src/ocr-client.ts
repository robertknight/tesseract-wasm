import * as comlink from "comlink";

import type { BoxItem, Orientation, TextItem, TextUnit } from "./ocr-engine";

// Although this import is Node-specific, it is tiny and doesn't import any
// Node libs, so can be included in a bundle that runs in non-Node environments.
//
// @ts-ignore
import nodeEndpoint from "comlink/dist/esm/node-adapter.mjs";

import { imageDataFromBitmap } from "./utils";

function defaultWorkerURL() {
  return new URL("./tesseract-worker.js", import.meta.url).href;
}

function createWebWorker(url: string) {
  return new Worker(url);
}

type ProgressListener = (progress: number) => void;

export type OCRClientInit = {
  /**
   * Callback that creates the worker. The default implementation creates a Web Worker.
   */
  createWorker?: (url: string) => Worker;

  /**
   * WebAssembly binary to load in worker. If not set, it is loaded from the
   * default location relative to the current script.
   */
  wasmBinary?: Uint8Array | ArrayBuffer;

  /**
   * Location of worker script/module. If not set, it is loaded from the default location relative to the
   * current script.
   */
  workerURL?: string;
};

/**
 * High-level async API for performing document image layout analysis and
 * OCR.
 *
 * In the browser, this class can be constructed directly. In Node, use the
 * `createOCRClient` helper from `node-worker.js`.
 */
export class OCRClient {
  private _worker: Worker;
  private _progressListeners: ProgressListener[];
  private _progressChannel: MessagePort;
  private _ocrEngine: any;

  /**
   * Initialize an OCR engine.
   *
   * This will start a Worker in which the OCR operations will actually be
   * performed.
   *
   */
  constructor({
    createWorker = createWebWorker,
    wasmBinary,
    workerURL = defaultWorkerURL(),
  }: OCRClientInit = {}) {
    const worker = createWorker(workerURL);
    this._worker = worker;

    this._progressListeners = [] as ProgressListener[];

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

    this._ocrEngine = (remote as any).createOCREngine(
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
   */
  async loadModel(model: string | ArrayBuffer): Promise<void> {
    const engine = await this._ocrEngine;
    if (typeof model === "string") {
      const response = await fetch(model);
      model = await response.arrayBuffer();
    }
    return engine.loadModel(model);
  }

  /**
   * Load an image into the OCR engine for processing.
   */
  async loadImage(image: ImageBitmap | ImageData): Promise<void> {
    // Convert ImageBitmap to ImageData. In browsers that don't support
    // OffscreenCanvas (Firefox and Safari as of 2022-06) we have to do this
    // on the main thread using a canvas. In Chrome, we still do this on the
    // main thread but using OffscreenCanvas, to work around an issue with
    // rotation information being lost. See
    // https://bugs.chromium.org/p/chromium/issues/detail?id=1332947.
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      image = imageDataFromBitmap(image);
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
   */
  async getBoundingBoxes(unit: TextUnit): Promise<BoxItem[]> {
    const engine = await this._ocrEngine;
    return engine.getBoundingBoxes(unit);
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return bounding boxes and text content for a given
   * unit of text.
   */
  async getTextBoxes(
    unit: TextUnit,
    onProgress?: ProgressListener
  ): Promise<TextItem[]> {
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
   */
  async getText(onProgress?: ProgressListener): Promise<string> {
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

  /**
   * Attempt to determine the orientation of the image.
   *
   * This currently uses a simplistic algorithm [1] which is designed for
   * non-uppercase Latin text. It will likely perform badly for other scripts or
   * if the text is all uppercase.
   *
   * [1] See http://www.leptonica.org/papers/skew-measurement.pdf
   */
  async getOrientation(): Promise<Orientation> {
    const engine = await this._ocrEngine;
    return engine.getOrientation();
  }

  _addProgressListener(listener: ProgressListener) {
    this._progressListeners.push(listener);
  }

  _removeProgressListener(listener: ProgressListener) {
    this._progressListeners = this._progressListeners.filter(
      (l) => l !== listener
    );
  }
}
