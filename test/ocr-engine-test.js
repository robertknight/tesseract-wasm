import { dirname } from "node:path";
import { readFile } from "node:fs/promises";

import { assert } from "chai";

import { createOCREngine } from "../dist/lib.js";
import { loadImage, resolve } from "./util.js";

async function createEngine() {
  const wasmBinary = await readFile(resolve("../dist/tesseract-core.wasm"));
  const ocr = await createOCREngine({ wasmBinary });

  const model = await readFile(
    resolve("../third_party/tessdata_fast/eng.traineddata")
  );
  ocr.loadModel(model);
  return ocr;
}

describe("OCREngine", () => {
  let ocr;

  before(async () => {
    ocr = await createEngine();
  });

  after(() => {
    ocr.destroy();
  });

  it("extracts text from image", async function () {
    this.timeout(10_000);

    const imageData = await loadImage(resolve("./test-page.jpg"));
    ocr.loadImage(imageData);

    const text = ocr
      .getTextBoxes("word")
      .map((word) => word.text)
      .join(" ");

    const expectedPhrases = [
      "Image Thresholding for Optical Character Recognition and Other Applications Requiring Character Image Extraction",
      "One of the most significant problems in Optical Character distribution",
    ];

    for (let phrase of expectedPhrases) {
      assert.include(text, phrase);
    }
  });
});
