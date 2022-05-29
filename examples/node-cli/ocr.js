import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import fetch from "node-fetch";
import { createOCREngine } from "tesseract-wasm";
import { loadWasmBinary } from "tesseract-wasm/node";
import sharp from "sharp";

async function loadImage(path) {
  const image = await sharp(path).ensureAlpha();
  const { width, height } = await image.metadata();
  return {
    data: await image.raw().toBuffer(),
    width,
    height,
  };
}

/** Resolve a URL relative to the current module. */
function resolve(path) {
  return fileURLToPath(new URL(path, import.meta.url).href);
}

const program = new Command();
program.description("Extract text from an image");
program.argument("file");
program.parse();

// Initialize the OCR engine. In this demo we use the synchronous OCREngine
// API directly. In a server you would want to use the async OCRClient API
// instead.
const wasmBinary = await loadWasmBinary();
const engine = await createOCREngine({ wasmBinary });

// Fetch the text recognition model and cache it locally, then load it into
// the OCR engine.
const modelPath = "eng.traineddata";
if (!existsSync(modelPath)) {
  process.stderr.write("Downloading text recognition model...\n");
  const modelURL =
    "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata";
  const response = await fetch(modelURL);
  if (!response.ok) {
    process.stderr.write(`Failed to download model from ${modelURL}`);
    process.exit(1);
  }
  const data = await response.arrayBuffer();
  writeFileSync(modelPath, new Uint8Array(data));
}
const model = readFileSync("eng.traineddata");
engine.loadModel(model);

// Load the image and perform OCR synchronously.
const image = await loadImage(program.args[0]);
engine.loadImage(image);

const text = engine.getText((progress) => {
  process.stderr.write(`\rRecognizing text (${progress}% done)...`);
});
process.stderr.write("\n\n");
process.stdout.write(text);
