// @ts-ignore - Don't error if library hasn't been built yet.
import initTesseractCore from "../build/tesseract-core";

import { imageDataFromBitmap } from "./utils";

/**
 * JS interface to a `std::vector` returned from a C++ method wrapped by
 * Embind.
 */
type StdVector<T> = {
  size: () => number;
  get: (index: number) => T;
};

/**
 * Create a JS array from a std::vector wrapper created by Embind.
 */
function jsArrayFromStdVector<T>(vec: StdVector<T>): T[] {
  const size = vec.size();
  const result = [];
  for (let i = 0; i < size; i++) {
    result.push(vec.get(i));
  }
  return result;
}

/**
 * Flags indicating position of a text item.
 *
 * Keep this in sync with `LayoutFlags` in lib.cpp.
 */
export const layoutFlags = {
  StartOfLine: 1,
  EndOfLine: 2,
};

export type IntRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * Item of text found in a document image by layout analysis.
 */
export type BoxItem = {
  rect: IntRect;

  /** Combination of flags from {@link layoutFlags} */
  flags: number;
};

/**
 * Item of text found in a document image by layout analysis and OCR.
 */
export type TextItem = {
  rect: IntRect;

  /** Combination of flags from {@link layoutFlags} */
  flags: number;

  /** Confidence score for this word in [0, 1] */
  confidence: number;

  text: string;
};

/**
 * Result of orientation detection.
 */
export type Orientation = {
  rotation: number;

  /** Confidence value in [0, 1] */
  confidence: number;
};

export type TextUnit = "line" | "word";

/**
 * Handler that receives OCR operation progress updates.
 */
export type ProgressListener = (progress: number) => void;

/**
 * Low-level synchronous API for performing OCR.
 *
 * Instances are constructed using {@link createOCREngine}.
 */
export class OCREngine {
  private _tesseractLib: any;
  private _engine: any;
  private _modelLoaded: boolean;
  private _imageLoaded: boolean;
  private _progressChannel?: MessagePort;

  /**
   * Initialize the OCREngine.
   *
   * Use {@link createOCREngine} rather than calling this directly.
   *
   * @param tessLib - Emscripten entry point for the compiled WebAssembly module.
   * @param progressChannel - Channel used to report progress
   *   updates when OCREngine is run on a background thread
   */
  constructor(tessLib: any, progressChannel?: MessagePort) {
    this._tesseractLib = tessLib;
    this._engine = new tessLib.OCREngine();
    this._modelLoaded = false;
    this._imageLoaded = false;
    this._progressChannel = progressChannel;
  }

  /**
   * Shut down the OCR engine and free up resources.
   */
  destroy() {
    this._engine.delete();
    this._engine = null;
  }

  /**
   * Get the value, represented as a string, of a Tesseract configuration variable.
   *
   * See {@link setVariable} for available variables.
   */
  getVariable(name: string): string {
    const result = this._engine.getVariable(name);
    if (!result.success) {
      throw new Error(`Unable to get variable ${name}`);
    }
    return result.value;
  }

  /**
   * Set the value of a Tesseract configuration variable.
   *
   * For a list of configuration variables, see
   * https://github.com/tesseract-ocr/tesseract/blob/677f5822f247ccb12b4e026265e88b959059fb59/src/ccmain/tesseractclass.cpp#L53
   *
   * If you have Tesseract installed locally, executing `tesseract --print-parameters`
   * will also display a list of configuration variables.
   */
  setVariable(name: string, value: string) {
    const result = this._engine.setVariable(name, value);
    if (result.error) {
      throw new Error(`Unable to set variable ${name}`);
    }
  }

  /**
   * Load a trained text recognition model.
   */
  loadModel(model: Uint8Array | ArrayBuffer) {
    const modelArray =
      model instanceof ArrayBuffer ? new Uint8Array(model) : model;
    const result = this._engine.loadModel(modelArray);
    if (result.error) {
      throw new Error("Text recognition model failed to load");
    }
    this._modelLoaded = true;
  }

  /**
   * Load a document image for processing by subsequent operations.
   *
   * This is a cheap operation as expensive processing is deferred until
   * bounding boxes or text content is requested.
   */
  loadImage(image: ImageBitmap | ImageData) {
    let imageData;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      imageData = imageDataFromBitmap(image);
    } else {
      imageData = image as ImageData;
    }

    if (imageData.data.length < imageData.width * imageData.height * 4) {
      throw new Error("Image data length does not match width/height");
    }

    if (imageData.width <= 0 || imageData.height <= 0) {
      throw new Error("Image width or height is zero");
    }

    // Free up resources used by the previous image, if any. Doing this before
    // creating the buffer for the new image reduces peak memory usage.
    this._engine.clearImage();

    // Allocate a temporary internal image for transfering the image data into
    // Tesseract
    const engineImage = new this._tesseractLib.Image(
      imageData.width,
      imageData.height
    );
    const engineImageBuf = engineImage.data();
    engineImageBuf.set(new Uint32Array(imageData.data.buffer));

    // Load the image. This will take a copy of the image within Tesseract, so
    // we can release the original afterwards.
    const result = this._engine.loadImage(engineImage);
    engineImage.delete();

    if (result.error) {
      throw new Error("Failed to load image");
    }

    this._imageLoaded = true;
  }

  /**
   * Clear the current image and text recognition results.
   *
   * This will clear the loaded image data internally, but keep the text
   * recognition model loaded.
   *
   * At present there is no way to shrink WebAssembly memory, so this will not
   * return the memory used by the image to the OS/browser. To release memory,
   * the `OCREngine` instance needs to be destroyed via {@link destroy}.
   */
  clearImage() {
    this._engine.clearImage();
    this._imageLoaded = false;
  }

  /**
   * Perform layout analysis on the current image, if not already done, and
   * return bounding boxes for a given unit of text.
   *
   * This operation is relatively cheap compared to text recognition, so can
   * provide much faster results if only the location of lines/words etc. on
   * the page is required, not the text content. This operation can also be
   * performed before a text recognition model is loaded.
   *
   * This method may return a different number/positions of words on a line
   * compared to {@link getTextBoxes} due to the simpler analysis. After full
   * OCR has been performed by {@link getTextBoxes} or {@link getText}, this
   * method should return the same results.
   */
  getBoundingBoxes(unit: TextUnit): BoxItem[] {
    this._checkImageLoaded();
    const textUnit = this._textUnitForUnit(unit);
    return jsArrayFromStdVector(this._engine.getBoundingBoxes(textUnit));
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return bounding boxes and text content for a given
   * unit of text.
   *
   * A text recognition model must be loaded with {@link loadModel} before this
   * is called.
   */
  getTextBoxes(unit: TextUnit, onProgress?: ProgressListener): TextItem[] {
    this._checkImageLoaded();
    this._checkModelLoaded();

    const textUnit = this._textUnitForUnit(unit);

    return jsArrayFromStdVector(
      this._engine.getTextBoxes(textUnit, (progress: number) => {
        onProgress?.(progress);
        this._progressChannel?.postMessage({ progress });
      })
    );
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return the page text as a string.
   *
   * A text recognition model must be loaded with {@link loadModel} before this
   * is called.
   */
  getText(onProgress?: ProgressListener): string {
    this._checkImageLoaded();
    this._checkModelLoaded();
    return this._engine.getText((progress: number) => {
      onProgress?.(progress);
      this._progressChannel?.postMessage({ progress });
    });
  }

  /**
   * Perform layout analysis and text recognition on the current image, if
   * not already done, and return the page text in hOCR format.
   *
   * A text recognition model must be loaded with {@link loadModel} before this
   * is called.
   */
  getHOCR(onProgress?: ProgressListener): string {
    this._checkImageLoaded();
    this._checkModelLoaded();
    return this._engine.getHOCR((progress: number) => {
      onProgress?.(progress);
      this._progressChannel?.postMessage({ progress });
    });
  }

  /**
   * Attempt to determine the orientation of the document image in degrees.
   *
   * This currently uses a simplistic algorithm [1] which is designed for
   * non-uppercase Latin text. It will likely perform badly for other scripts or
   * if the text is all uppercase.
   *
   * [1] See http://www.leptonica.org/papers/skew-measurement.pdf
   */
  getOrientation(): Orientation {
    this._checkImageLoaded();
    return this._engine.getOrientation();
  }

  private _checkModelLoaded() {
    if (!this._modelLoaded) {
      throw new Error("No text recognition model loaded");
    }
  }

  private _checkImageLoaded() {
    if (!this._imageLoaded) {
      throw new Error("No image loaded");
    }
  }

  private _textUnitForUnit(unit: TextUnit) {
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

function resolve(path: string, baseURL: string) {
  return new URL(path, baseURL).href;
}

/**
 * Return true if the current JS runtime supports all the WebAssembly features
 * needed for the "fast" WebAssembly build. If not, the "fallback" version must
 * be used.
 */
export function supportsFastBuild() {
  return wasmSIMDSupported();
}

export type CreateOCREngineOptions = {
  /**
   * WebAssembly binary to load. This can be used to customize how the binary URL
   * is determined and fetched. {@link supportsFastBuild} can be used to
   * determine which build to load.
   */
  wasmBinary?: Uint8Array | ArrayBuffer;
  progressChannel?: MessagePort;
};

/**
 * Initialize the OCR library and return a new {@link OCREngine}.
 */
export async function createOCREngine({
  wasmBinary,
  progressChannel,
}: CreateOCREngineOptions = {}) {
  if (!wasmBinary) {
    const wasmPath = supportsFastBuild()
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
  return new OCREngine(tessLib, progressChannel);
}
