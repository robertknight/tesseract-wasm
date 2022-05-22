import { dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { createOCREngine } from "../dist/lib.js";

function resolve(path) {
  return fileURLToPath(new URL(path, import.meta.url).href);
}

const wasmBinary = await readFile(resolve("../dist/tesseract-core.wasm"));
const ocr = await createOCREngine({ wasmBinary });

const model = await readFile(
  resolve("../third_party/tessdata_fast/eng.traineddata")
);
ocr.loadModel(model);

const image = await sharp(resolve("./test-page.jpg")).ensureAlpha();
const { width, height } = await image.metadata();
const imageData = {
  data: await image.raw().toBuffer(),
  width,
  height,
};
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
  if (!text.includes(phrase)) {
    console.debug("OCR output: ", text);
    throw new Error(`Expected phrase not found in OCR output: ${phrase}`);
  }
}
