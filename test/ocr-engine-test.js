import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import sharp from "sharp";

import {
  createOCREngine,
  layoutFlags,
  supportsFastBuild,
} from "../dist/lib.js";
import { loadImage, resolve, toImageData } from "./util.js";

const { StartOfLine, EndOfLine } = layoutFlags;

async function createEngine({
  loadModel = true,
  emscriptenModuleOptions = {},
} = {}) {
  const wasmBinary = await readFile(resolve("../dist/tesseract-core.wasm"));
  const ocr = await createOCREngine({ wasmBinary, emscriptenModuleOptions });

  if (loadModel) {
    const model = await readFile(
      resolve("../third_party/tessdata_fast/eng.traineddata"),
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
    assert.strict(supportsFastBuild());
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
      assert.throws(
        () => {
          ocr.loadImage(imageData);
        },
        new Error(expectedError),
        undefined,
      );
    });
  });

  it("throws an error if OCR is attempted before image is loaded", async () => {
    const ocr = await createEngine();

    assert.throws(
      () => {
        ocr.getBoundingBoxes();
      },
      new Error("No image loaded"),
      undefined,
    );

    assert.throws(
      () => {
        ocr.getTextBoxes();
      },
      new Error("No image loaded"),
      undefined,
    );

    assert.throws(
      () => {
        ocr.getText();
      },
      new Error("No image loaded"),
      undefined,
    );
  });

  it("throws an error if OCR is attempted before model is loaded", async () => {
    const ocr = await createEngine({ loadModel: false });
    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    assert.throws(
      () => {
        ocr.getTextBoxes();
      },
      new Error("No text recognition model loaded"),
      undefined,
    );

    assert.throws(
      () => {
        ocr.getText();
      },
      new Error("No text recognition model loaded"),
      undefined,
    );
  });

  it("throws an error if you attempt get the value of a nonsense variable", async () => {
    const ocr = await createEngine({ loadModel: false });
    assert.throws(
      () => {
        ocr.getVariable("nonsense");
      },
      new Error("Unable to get variable nonsense"),
      undefined,
    );
  });

  it("throws an error if you attempt set the value of a nonsense variable", async () => {
    const ocr = await createEngine({ loadModel: false });
    assert.throws(
      () => {
        ocr.setVariable("nonsense", "nonsense");
      },
      new Error("Unable to set variable nonsense"),
      undefined,
    );
  });

  it("successfully sets configuration variables", async () => {
    const ocr = await createEngine({ loadModel: false });
    const varName = "user_defined_dpi";
    const varValue = "300";
    ocr.setVariable(varName, varValue);
    const dpi = ocr.getVariable(varName);
    assert.strictEqual(dpi, varValue);
  });

  it(
    "extracts bounding boxes from image",
    { timeout: 2_000 },
    async function () {
      const imageData = await loadImage(resolve("./small-test-page.jpg"));
      ocr.loadImage(imageData);

      // nb. The number of boxes returned here is slightly different than the
      // test below which reads text boxes. This is because `getBoundingBoxes`
      // performs a faster/simpler analysis and `getTextBoxes` triggers the more
      // expensive LSTM-based analysis.
      const wordBoxes = ocr.getBoundingBoxes("word");
      assert.strictEqual(wordBoxes.length, 153);

      for (let box of wordBoxes) {
        const { rect } = box;

        assert.strictEqual(typeof rect.left, "number");
        assert.strictEqual(typeof rect.right, "number");
        assert.strictEqual(typeof rect.top, "number");
        assert.strictEqual(typeof rect.bottom, "number");

        assert.strict(rect.left >= 0 && rect.left <= imageData.width);
        assert.strict(rect.right >= 0 && rect.right <= imageData.width);
        assert.strict(rect.right > rect.left);

        assert.strict(rect.top >= 0 && rect.top <= imageData.height);
        assert.strict(rect.bottom >= 0 && rect.bottom <= imageData.height);
        assert.strict(rect.bottom > rect.top);
      }

      const lineBoxes = ocr.getBoundingBoxes("line");
      assert.strictEqual(lineBoxes.length, 10);
    },
  );

  it("can extract bounding boxes without a model loaded", async function () {
    const ocr = await createEngine({ loadModel: false });

    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const wordBoxes = ocr.getBoundingBoxes("word");
    assert.strictEqual(wordBoxes.length, 153);
  });

  it("extracts text boxes from image", { timeout: 10_000 }, async function () {
    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const wordBoxes = ocr.getTextBoxes("word");
    assert.strictEqual(wordBoxes.length, 159);
    assert.strictEqual(wordBoxes.at(0).text, "Image");
    assert.strictEqual(wordBoxes.at(-1).text, "complexity.");
    let meanLength = mean(wordBoxes.map((b) => b.text.length));
    assert.strict(meanLength >= 4);
    assert.strict(meanLength <= 8);
    let meanConfidence = mean(wordBoxes.map((b) => b.confidence));
    assert.strict(meanConfidence >= 0.9);

    const lineBoxes = ocr.getTextBoxes("line");
    assert.strictEqual(lineBoxes.length, 10);
    assert.strictEqual(
      lineBoxes.at(0).text,
      "Image Thresholding for Optical Character Recognition and\n",
    );
    assert.strictEqual(
      lineBoxes.at(-1).text,
      "second is a more aggressive approach directed toward specialized, high-volume applications which justify extra complexity.\n",
    );
    const meanLength2 = mean(lineBoxes.map((b) => b.text.length));
    assert.strict(meanLength2 >= 108);
    assert.strict(meanLength2 <= 112);
    const meanConfidence2 = mean(lineBoxes.map((b) => b.confidence));
    assert.strict(meanConfidence2 >= 0.9);
  });

  [
    [100, 100],
    [200, 200],
    [1, 1],
  ].forEach(([width, height]) => {
    it("extracts bounding boxes for empty image", async () => {
      ocr.loadImage(emptyImage(width, height));
      const wordBoxes = ocr.getBoundingBoxes("word");
      assert.strictEqual(wordBoxes.length, 0);
    });

    // For an empty image, Tesseract returns a single box with all-zero coordinates
    // and empty text 🤷
    it("extracts text boxes for empty image", async () => {
      ocr.loadImage(emptyImage(width, height));
      const wordBoxes = ocr.getTextBoxes("word");
      assert.strictEqual(wordBoxes.length, 1);
    });
  });

  it("extracts layout flags from image", { timeout: 5_000 }, async function () {
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

  it("extracts text from image", { timeout: 5_000 }, async function () {
    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const text = ocr.getText();

    const expectedPhrases = [
      "Image Thresholding for Optical Character Recognition and\nOther Applications Requiring Character Image Extraction",
      "This thresholding is a critical step",
    ];

    for (let phrase of expectedPhrases) {
      assert.strict(text.includes(phrase));
    }
  });

  it(
    "accepts emscripten module options",
    { timeout: 5_000 },
    async function () {
      let stderr = "";
      const writeToStderr = (s) => {
        stderr += s;
      };

      const ocr = await createEngine({
        emscriptenModuleOptions: { printErr: writeToStderr },
      });

      const imageData = await loadImage(resolve("./small-test-page.jpg"));
      ocr.loadImage(imageData);

      ocr.getText();

      assert.strictEqual(stderr, "Estimating resolution as 171");
    },
  );

  it("extracts hOCR from image", { timeout: 5_000 }, async function () {
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
      assert.strict(html.includes(phrase));
    }
  });

  it("reports recognition progress", { timeout: 5_000 }, async function () {
    const imageData = await loadImage(resolve("./small-test-page.jpg"));
    ocr.loadImage(imageData);

    const progressSteps = [];
    ocr.getText((progress) => {
      progressSteps.push(progress);
    });

    assert.strict(progressSteps.length > 0);
    for (let [i, progress] in progressSteps.entries()) {
      assert.strict(progress >= 0);
      assert.strict(progress <= 100);
      if (i > 0) {
        assert.strict(progress > progressSteps[i - 1]);
      }
    }

    // We should always get 100% progress at the end.
    assert.strictEqual(progressSteps.at(-1), 100);

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

      assert.strictEqual(estimatedOrient.rotation, rotation);
      assert.strictEqual(estimatedOrient.confidence, 1);
    }
  });

  it("clears the image", async () => {
    ocr.loadImage(emptyImage(100, 100));
    ocr.getBoundingBoxes("word");

    ocr.clearImage();

    assert.throws(
      () => {
        ocr.getBoundingBoxes("word");
      },
      new Error("No image loaded"),
      undefined,
    );
  });
});
