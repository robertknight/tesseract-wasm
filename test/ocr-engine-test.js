import { dirname } from "node:path";
import { readFile } from "node:fs/promises";

import { assert } from "chai";

import { createOCREngine, layoutFlags } from "../dist/lib.js";
import { loadImage, resolve } from "./util.js";

const { StartOfLine, EndOfLine } = layoutFlags;

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

function mean(values) {
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function emptyImage(width = 100, height = 100) {
  const data = new ArrayBuffer(width * 4 * height);

  const u8Array = new Uint8Array(data);
  u8Array.fill(0xff);

  return {
    data,
    width,
    height,
  };
}

describe("OCREngine", () => {
  let ocr;

  before(async () => {
    ocr = await createEngine();
  });

  after(() => {
    ocr.destroy();
  });

  [
    // Image size does not match buffer size
    {
      data: new ArrayBuffer(10),
      width: 100,
      height: 100,
    },
    // Zero width image
    emptyImage(0, 100),

    // Zero height image
    emptyImage(100, 0),
  ].forEach((imageData) => {
    it("throws an error if image fails to load", () => {
      assert.throws(() => {
        ocr.loadImage(imageData);
      }, "Failed to load image");
    });
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

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    // nb. The number of boxes returned here is slightly different than the
    // test below which reads text boxes. This is because `getBoundingBoxes`
    // performs a faster/simpler analysis and `getTextBoxes` triggers the more
    // expensive LSTM-based analysis.
    const wordBoxes = ocr.getBoundingBoxes("word");
    assert.equal(wordBoxes.length, 159);

    for (let box of wordBoxes) {
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

    const lineBoxes = ocr.getBoundingBoxes("line");
    assert.equal(lineBoxes.length, 12);
  });

  it("extracts text boxes from image", async function () {
    this.timeout(10_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const wordBoxes = ocr.getTextBoxes("word");
    assert.equal(wordBoxes.length, 165);
    assert.equal(wordBoxes.at(0).text, "J.");
    assert.equal(wordBoxes.at(-1).text, "complexity.");
    assert.approximately(mean(wordBoxes.map((b) => b.text.length)), 6, 2);
    assert.approximately(mean(wordBoxes.map((b) => b.confidence)), 0.95, 3);

    const lineBoxes = ocr.getTextBoxes("line");
    assert.equal(lineBoxes.length, 12);
    assert.equal(lineBoxes.at(0).text, "J. M. White\n\n");
    assert.equal(
      lineBoxes.at(-1).text,
      "second is a more aggressive approach directed toward specialized, high-volume applications which justify extra complexity.\n"
    );
    assert.approximately(mean(lineBoxes.map((b) => b.text.length)), 94, 2);
    assert.approximately(mean(lineBoxes.map((b) => b.confidence)), 0.95, 3);
  });

  [
    [100, 100],
    [200, 200],
    [1, 1],
  ].forEach(([width, height]) => {
    it("extracts bounding boxes for empty image", async () => {
      ocr.loadImage(emptyImage(width, height));
      const wordBoxes = ocr.getBoundingBoxes("word");
      assert.equal(wordBoxes.length, 0);
    });

    // For an empty image, Tesseract returns a single box with all-zero coordinates
    // and empty text 🤷
    it("extracts text boxes for empty image", async () => {
      ocr.loadImage(emptyImage(width, height));
      const wordBoxes = ocr.getTextBoxes("word");
      assert.equal(wordBoxes.length, 1);
    });
  });

  it("extracts layout flags from image", async function () {
    this.timeout(5_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const wordBoxes = ocr.getTextBoxes("word");
    const lineStarts = wordBoxes
      .filter((b) => b.flags & StartOfLine)
      .map((b) => b.text);
    const lineEnds = wordBoxes
      .filter((b) => b.flags & EndOfLine)
      .map((b) => b.text);

    assert.deepEqual(lineStarts, [
      "J.",
      "G.",
      "Image",
      "Other",
      "Two",
      "hand-printed",
      "to",
      "does",
      "Image",
      "forms",
      "nonlinear,",
      "second",
    ]);
    assert.deepEqual(lineEnds, [
      "White",
      "Rohrer",
      "and",
      "Extraction",
      "or",
      "algorithms",
      "it",
      "Character",
      "copy",
      "a",
      "The",
      "complexity.",
    ]);
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
