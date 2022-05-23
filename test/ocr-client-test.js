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

  it("extracts text from image", async function () {
    this.timeout(10_000);

    const imageData = await loadImage(resolve("./test-page.jpg"));
    await ocr.loadImage(imageData);

    const textBoxes = await ocr.getTextBoxes("word");
    const text = textBoxes.map((word) => word.text).join(" ");

    const expectedPhrases = [
      "Image Thresholding for Optical Character Recognition and Other Applications Requiring Character Image Extraction",
      "One of the most significant problems in Optical Character distribution",
    ];

    for (let phrase of expectedPhrases) {
      assert.include(text, phrase);
    }
  });
});
