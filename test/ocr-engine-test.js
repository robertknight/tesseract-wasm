import { dirname } from "node:path";
import { readFile } from "node:fs/promises";

import { assert } from "chai";

import { createOCREngine } from "../dist/lib.js";
import { loadImage, resolve } from "./util.js";

async function createEngine({ loadModel = true } = {}) {
  const wasmBinary = await readFile(resolve("../dist/tesseract-core.wasm"));
  const ocr = await createOCREngine({ wasmBinary });

  if (loadModel) {
    const model = await readFile(
      resolve("../third_party/tessdata_fast/eng.traineddata")
    );
    ocr.loadModel(model);
  }

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

  it("throws an error if image fails to load", () => {
    assert.throws(() => {
      ocr.loadImage({
        data: new ArrayBuffer(10),

        // Image size does not match buffer size
        width: 100,
        height: 100,
      });
    }, "Failed to load image");
  });

  it("throws an error if image is loaded before model", async function () {
    this.timeout(10_000);
    const ocr = await createEngine({ loadModel: false });
    const imageData = await loadImage(resolve("./test-page.jpg"));
    assert.throws(() => {
      ocr.loadImage(imageData);
    }, "Model must be loaded before image");
  });

  it("throws an error if OCR is attempted before image is loaded", async () => {
    assert.throws(() => {
      ocr.getBoundingBoxes();
    }, "No image loaded");

    assert.throws(() => {
      ocr.getTextBoxes();
    }, "No image loaded");
  });

  it("extracts bounding boxes from image", async function () {
    this.timeout(2_000);

    const imageData = await loadImage(resolve("./test-page.jpg"));
    ocr.loadImage(imageData);

    const boxes = ocr.getBoundingBoxes("word");
    assert.isTrue(boxes.length >= 640 && boxes.length < 650);
    for (let box of boxes) {
      assert.isNumber(box.left);
      assert.isNumber(box.right);
      assert.isNumber(box.top);
      assert.isNumber(box.bottom);

      assert.isTrue(box.left >= 0 && box.left <= imageData.width);
      assert.isTrue(box.right >= 0 && box.right <= imageData.width);
      assert.isTrue(box.right > box.left);

      assert.isTrue(box.top >= 0 && box.top <= imageData.height);
      assert.isTrue(box.bottom >= 0 && box.bottom <= imageData.height);
      assert.isTrue(box.bottom > box.top);
    }
  });

  it("extracts text boxes from image", async function () {
    this.timeout(10_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const text = ocr
      .getTextBoxes("word")
      .map((word) => word.text)
      .join(" ");

    const expectedPhrases = [
      "Image Thresholding for Optical Character Recognition and Other Applications Requiring Character Image Extraction",
      "This thresholding is a critical step",
    ];

    for (let phrase of expectedPhrases) {
      assert.include(text, phrase);
    }
  });

  it("extracts text from image", async function () {
    this.timeout(5_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const text = ocr.getText();

    const expectedPhrases = [
      "Image Thresholding for Optical Character Recognition and\nOther Applications Requiring Character Image Extraction",
      "This thresholding is a critical step",
    ];

    for (let phrase of expectedPhrases) {
      assert.include(text, phrase);
    }
  });
});
