import { readFile } from "node:fs/promises";

import { assert } from "chai";

import { createOCRClient } from "../src/node-worker.js";
import { loadImage, resolve } from "./util.js";

async function createClient() {
  const ocr = createOCRClient();
  const model = await readFile(
    resolve("../third_party/tessdata_fast/eng.traineddata"),
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

  it("extracts hOCR from image", async function () {
    this.timeout(5_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    await ocr.loadImage(imageData);

    const html = await ocr.getHOCR();

    // Expected output snippets, covering different kinds of entity (word, line, page).
    const expectedPhrases = [
      "class='ocr_page' id='page_1'",
      "<span class='ocrx_word' id='word_1_1' title='bbox 37 233 135 265; x_wconf 93'>Image</span>",
      `<span class='ocr_line' id='line_1_5' title="bbox 36 443 1026 462; baseline 0 -5; x_size 18; x_descenders 4; x_ascenders 3">`,
    ];

    for (let phrase of expectedPhrases) {
      assert.include(html, phrase);
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
    const orient = await ocr.getOrientation();
    assert.equal(orient.rotation, 0);
    assert.equal(orient.confidence, 1.0);
  });

  it("clears the image", async () => {
    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    await ocr.loadImage(imageData);
    await ocr.getBoundingBoxes("word");

    await ocr.clearImage();

    let error;
    try {
      await ocr.getBoundingBoxes("word");
    } catch (e) {
      error = e;
    }

    assert.instanceOf(error, Error);
    assert.equal(error.message, "No image loaded");
  });
});
