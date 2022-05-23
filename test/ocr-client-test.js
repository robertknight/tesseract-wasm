import { readFile } from "node:fs/promises";

import { assert } from "chai";

import { createOCRClient } from "../src/node-worker.js";
import { loadImage, resolve } from "./util.js";

async function createClient() {
  const ocr = createOCRClient();
  const model = await readFile(
    resolve("../third_party/tessdata_fast/eng.traineddata")
  );
  await ocr.loadModel(model);
  return ocr;
}

describe("OCRClient", () => {
  let ocr;

  before(async () => {
    ocr = await createClient();
  });

  after(() => {
    ocr.destroy();
  });

  it("extracts bounding boxes from image", async function () {
    this.timeout(2_000);

    const imageData = await loadImage(resolve("./test-page.jpg"));
    await ocr.loadImage(imageData);

    const boxes = await ocr.getBoundingBoxes("word");
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
    this.timeout(5_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    await ocr.loadImage(imageData);

    const textBoxes = await ocr.getTextBoxes("word");
    const text = textBoxes.map((word) => word.text).join(" ");

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
    await ocr.loadImage(imageData);

    const text = await ocr.getText();

    const expectedPhrases = [
      "Image Thresholding for Optical Character Recognition and\nOther Applications Requiring Character Image Extraction",
      "This thresholding is a critical step",
    ];

    for (let phrase of expectedPhrases) {
      assert.include(text, phrase);
    }
  });
});
