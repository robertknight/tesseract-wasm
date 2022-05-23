// @ts-ignore - Don't error if library hasn't been built yet.
import initTesseractCore from "../build/tesseract-core";

/**
 * JS interface to a `std::vector` returned from a C++ method wrapped by
 * Embind.
 *
 * @template T
 * @typedef StdVector
 * @prop {() => number} size
 * @prop {(index: number) => T} get
 */

/**
 * @param {ImageBitmap} bitmap
 */
function imageDataFromBitmap(bitmap) {
  // @ts-expect-error - OffscreenCanvas API is missing
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  /** @type {CanvasRenderingContext2D} */
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Create a JS array from a std::vector wrapper created by Embind.
 *
 * @template T
 * @param {StdVector<T>} vec
 * @return {T[]}
 */
function jsArrayFromStdVector(vec) {
  const size = vec.size();
  const result = [];
  for (let i = 0; i < size; i++) {
    result.push(vec.get(i));
  }
  return result;
}

/**
 * @typedef IntRect
 * @prop {number} left
 * @prop {number} top
 * @prop {number} right
 * @prop {number} bottom
 */

/**
 * @typedef TextRect
 * @prop {IntRect} rect
 * @prop {string} text
 */

/**
 * @typedef {'line'|'word'} TextUnit
 */

/**
 * Low-level synchronous API for performing OCR.
 *
 */
export class OCREngine {
  /**
   * @param {any} tessLib
   */
  constructor(tessLib) {
    this._tesseractLib = tessLib;
    this._engine = new tessLib.OCREngine();
    this._modelLoaded = false;
    this._imageLoaded = false;
  }

  /**
   * Shut down the OCR engine and free up resources.
   */
  destroy() {
    this._engine.delete();
    this._engine = null;
  }

  /**
   * Load a trained text recognition model.
   *
   * @param {Uint8Array|ArrayBuffer} model
   */
  loadModel(model) {
    const modelArray =
      model instanceof ArrayBuffer ? new Uint8Array(model) : model;
    const result = this._engine.loadModel(modelArray);
    if (result !== 0) {
      throw new Error("Text recognition model failed to load");
    }
    this._modelLoaded = true;
  }

  /**
   * Load a document image for processing by subsequent operations.
   *
   * This is a cheap operation as expensive processing is deferred until
   * bounding boxes or text content is requested.
   *
   * @param {ImageBitmap|ImageData} image
   */
  loadImage(image) {
    if (!this._modelLoaded) {
      throw new Error("Model must be loaded before image");
    }

    let imageData;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      imageData = imageDataFromBitmap(image);
    } else {
      imageData = /** @type {ImageData} */ (image);
    }

    const result = this._engine.loadImage(
      imageData.data,
      imageData.width,
      imageData.height,
      4 /* bytesPerPixel */,
      imageData.width * 4 /* bytesPerLine */
    );

    if (result !== 0) {
      throw new Error("Failed to load image");
    }

    this._imageLoaded = true;
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
   * @return {IntRect[]}
   */
  getBoundingBoxes(unit) {
    if (!this._imageLoaded) {
      throw new Error("No image loaded");
    }
    const textUnit = this._textUnitForUnit(unit);
    return jsArrayFromStdVector(this._engine.getBoundingBoxes(textUnit));
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return bounding boxes and text content for a given
   * unit of text.
   *
   * @param {TextUnit} unit
   * @return {TextRect[]}
   */
  getTextBoxes(unit) {
    if (!this._imageLoaded) {
      throw new Error("No image loaded");
    }
    const textUnit = this._textUnitForUnit(unit);
    return jsArrayFromStdVector(this._engine.getText(textUnit));
  }

  /** @param {TextUnit} unit */
  _textUnitForUnit(unit) {
    const { TextUnit } = this._tesseractLib;
    switch (unit) {
      case "word":
        return TextUnit.Word;
      case "line":
        return TextUnit.Line;
      default:
        throw new Error("Invalid text unit");
    }
  }
}
function wasmSIMDSupported() {
  // Tiny WebAssembly file generated from the following source using `wat2wasm`:
  //
  // (module
  //   (func (result v128)
  //     i32.const 0
  //     i8x16.splat
  //     i8x16.popcnt
  //   )
  // )
  const simdTest = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
    8, 0, 65, 0, 253, 15, 253, 98, 11,
  ]);
  return WebAssembly.validate(simdTest);
}

/**
 * @param {string} path
 * @param {string} baseURL
 */
function resolve(path, baseURL) {
  return new URL(path, baseURL).href;
}

/**
 * Initialize the OCR library and return a new {@link OCREngine}.
 *
 * @param {object} options
 *   @param {Uint8Array|ArrayBuffer} [options.wasmBinary]
 */
export async function createOCREngine({ wasmBinary } = {}) {
  if (!wasmBinary) {
    const wasmPath = wasmSIMDSupported()
      ? "./tesseract-core.wasm"
      : "./tesseract-core-fallback.wasm";

    // nb. If this code is included in a non-ESM bundle, Rollup will replace
    // `import.meta.url` with code that uses `document.currentScript` /
    // `location.href`.
    const wasmURL = resolve(wasmPath, import.meta.url);
    const wasmBinaryResponse = await fetch(wasmURL);
    wasmBinary = await wasmBinaryResponse.arrayBuffer();
  }
  const tessLib = await initTesseractCore({ wasmBinary });
  return new OCREngine(tessLib);
}
