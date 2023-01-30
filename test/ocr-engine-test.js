import { readFile } from "node:fs/promises";

import { assert } from "chai";
import sharp from "sharp";

import {
  createOCREngine,
  layoutFlags,
  supportsFastBuild,
} from "../dist/lib.js";
import { loadImage, resolve, toImageData } from "./util.js";

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

describe("supportsFastBuild", () => {
  it("returns true in a modern Node engine", () => {
    assert.isTrue(supportsFastBuild());
  });
});

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
    [
      {
        data: new Uint8ClampedArray(10),
        width: 100,
        height: 100,
      },
      "Image data length does not match width/height",
    ],

    // Zero width image
    [emptyImage(0, 100), "Image width or height is zero"],

    // Zero height image
    [emptyImage(100, 0), "Image width or height is zero"],
  ].forEach(([imageData, expectedError]) => {
    it("throws an error if image fails to load", () => {
      assert.throws(() => {
        ocr.loadImage(imageData);
      }, expectedError);
    });
  });

  it("throws an error if OCR is attempted before image is loaded", async () => {
    const ocr = await createEngine();

    assert.throws(() => {
      ocr.getBoundingBoxes();
    }, "No image loaded");

    assert.throws(() => {
      ocr.getTextBoxes();
    }, "No image loaded");

    assert.throws(() => {
      ocr.getText();
    }, "No image loaded");
  });

  it("throws an error if OCR is attempted before model is loaded", async () => {
    const ocr = await createEngine({ loadModel: false });
    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    assert.throws(() => {
      ocr.getTextBoxes();
    }, "No text recognition model loaded");

    assert.throws(() => {
      ocr.getText();
    }, "No text recognition model loaded");
  });

  it("throws an error if you attempt get the value of a nonsense variable", async () => {
    const ocr = await createEngine({ loadModel: false });
    assert.throws(() => {
      ocr.getVariable("nonsense");
    }, "Unable to get variable nonsense");
  });

  it("throws an error if you attempt set the value of a nonsense variable", async () => {
    const ocr = await createEngine({ loadModel: false });
    assert.throws(() => {
      ocr.setVariable("nonsense", "nonsense");
    }, "Unable to set variable nonsense");
  });

  it("successfully sets configuration variables", async () => {
    const ocr = await createEngine({ loadModel: false });
    const varName = "user_defined_dpi";
    const varValue = "300";
    ocr.setVariable(varName, varValue);
    const dpi = ocr.getVariable(varName);
    assert.equal(dpi, varValue);
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
    assert.equal(wordBoxes.length, 153);

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
    assert.equal(lineBoxes.length, 10);
  });

  it("can extract bounding boxes without a model loaded", async function () {
    const ocr = await createEngine({ loadModel: false });

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const wordBoxes = ocr.getBoundingBoxes("word");
    assert.equal(wordBoxes.length, 153);
  });

  it("extracts text boxes from image", async function () {
    this.timeout(10_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const wordBoxes = ocr.getTextBoxes("word");
    assert.equal(wordBoxes.length, 159);
    assert.equal(wordBoxes.at(0).text, "Image");
    assert.equal(wordBoxes.at(-1).text, "complexity.");
    assert.approximately(mean(wordBoxes.map((b) => b.text.length)), 6, 2);
    assert.approximately(mean(wordBoxes.map((b) => b.confidence)), 0.95, 3);

    const lineBoxes = ocr.getTextBoxes("line");
    assert.equal(lineBoxes.length, 10);
    assert.equal(
      lineBoxes.at(0).text,
      "Image Thresholding for Optical Character Recognition and\n"
    );
    assert.equal(
      lineBoxes.at(-1).text,
      "second is a more aggressive approach directed toward specialized, high-volume applications which justify extra complexity.\n"
    );
    assert.approximately(mean(lineBoxes.map((b) => b.text.length)), 110, 2);
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

  it("extracts hOCR from image", async function () {
    this.timeout(5_000);

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const html = ocr.getHOCR();

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
    ocr.loadImage(imageData);

    const progressSteps = [];
    ocr.getText((progress) => {
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

    // We should always get 100% progress at the end.
    assert.equal(progressSteps.at(-1), 100);

    // If recognition has already been completed, progress should jump to 100.
    progressSteps.splice(0, progressSteps.length);
    ocr.getText((progress) => {
      progressSteps.push(progress);
    });
    assert.deepEqual(progressSteps, [100]);
  });

  it("can determine image orientation", async () => {
    const imagePath = resolve("./small-test-page.jpg");

    for (let rotation of [0, 90, 180, 270]) {
      const image = await sharp(imagePath).ensureAlpha().rotate(rotation);

      ocr.loadImage(await toImageData(image));
      const estimatedOrient = ocr.getOrientation();

      assert.equal(estimatedOrient.rotation, rotation);
      assert.equal(estimatedOrient.confidence, 1);
    }
  });

  it("clears the image", async () => {
    ocr.loadImage(emptyImage(100, 100));
    ocr.getBoundingBoxes("word");

    ocr.clearImage();

    assert.throws(() => {
      ocr.getBoundingBoxes("word");
    }, "No image loaded");
  });
});
