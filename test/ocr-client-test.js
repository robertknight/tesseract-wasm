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

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    await ocr.loadImage(imageData);

    const boxes = await ocr.getBoundingBoxes("word");
    assert.equal(boxes.length, 153);
    for (let box of boxes) {
      const { rect } = box;

      assert.isNumber(rect.left);
      assert.isNumber(rect.right);
      assert.isNumber(rect.top);
      assert.isNumber(rect.bottom);

      assert.isTrue(rect.left >= 0 && rect.left <= imageData.width);
      assert.isTrue(rect.right >= 0 && rect.right <= imageData.width);
      assert.isTrue(rect.right > rect.left);

      assert.isTrue(rect.top >= 0 && rect.top <= imageData.height);
      assert.isTrue(rect.bottom >= 0 && rect.bottom <= imageData.height);
      assert.isTrue(rect.bottom > rect.top);
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

  it("reports recognition progress", async function () {
    this.timeout(5_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    await ocr.loadImage(imageData);

    const progressSteps = [];
    const text = await ocr.getText((progress) => {
      progressSteps.push(progress);
    });

    assert.isAbove(progressSteps.length, 0);
    for (let [i, progress] in progressSteps.entries()) {
      assert.isAboveOrEqual(progess, 0);
      assert.isBelowOrEqual(progress, 100);
      if (i > 0) {
        assert.isAbove(progress, progressSteps[i - 1]);
      }
    }
  });

  // Test orientation detection method returns a result. Detailed tests for
  // different orientations are handled in the OCREngine tests.
  it("can determine image orientation", async () => {
    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    await ocr.loadImage(imageData);
    const orientation = await ocr.getOrientation();
    assert.equal(orientation, 0);
  });
});
