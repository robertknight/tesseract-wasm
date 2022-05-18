import initOCRLib from "../build/ocr-lib";

/**
 * @param {ImageBitmap} bitmap
 */
function imageDataFromBitmap(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Create a JS array from a std::vector wrapper created by Embind.
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
  constructor(ocrLib) {
    this._ocrLib = ocrLib;
    this._engine = new ocrLib.OCREngine();
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
    const imageData =
      image instanceof ImageBitmap ? imageDataFromBitmap(image) : image;

    this._engine.loadImage(
      imageData.data,
      imageData.width,
      imageData.height,
      4 /* bytesPerPixel */,
      imageData.width * 4 /* bytesPerLine */
    );
  }

  /**
   * Perform layout analysis on the current image, if not already done, and
   * return bounding boxes for a given unit of text.
   *
   * This operation is relatively cheap compared to text recognition, so can
   * provide much faster results if only the location of lines/words etc. on
   * the page is required, not the text content.
   *
   * @param {TextUnit}
   * @return {IntRect[]}
   */
  getBoundingBoxes(unit) {
    const textUnit = this._textUnitForUnit(unit);
    return jsArrayFromStdVector(this._engine.getBoundingBoxes(textUnit));
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return bounding boxes and text content for a given
   * unit of text.
   *
   * @param {TextUnit}
   * @return {TextRect[]}
   */
  getTextBoxes(unit) {
    const textUnit = this._textUnitForUnit(unit);
    return jsArrayFromStdVector(this._engine.getText(textUnit));
  }

  _textUnitForUnit(unit) {
    const { TextUnit } = this._ocrLib;
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

/**
 * Initialize the OCR library and return a new {@link OCREngine}.
 */
export async function createOCREngine() {
  const ocrLib = await initOCRLib();
  return new OCREngine(ocrLib);
}
