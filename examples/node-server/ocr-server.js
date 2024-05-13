import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";

import fetch from "node-fetch";
import { createOCRClient } from "tesseract-wasm/node";
import sharp from "sharp";

async function loadImage(buffer) {
  const image = await sharp(buffer).ensureAlpha();
  const { width, height } = await image.metadata();
  return {
    data: await image.raw().toBuffer(),
    width,
    height,
  };
}

async function loadModel() {
  const modelPath = "eng.traineddata";
  if (!existsSync(modelPath)) {
    console.log("Downloading text recognition model...");
    const modelURL =
      "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata";
    const response = await fetch(modelURL);
    if (!response.ok) {
      process.stderr.write(`Failed to download model from ${modelURL}`);
      process.exit(1);
    }
    const data = await response.arrayBuffer();
    await writeFile(modelPath, new Uint8Array(data));
  }
  return readFile("eng.traineddata");
}

async function readRequestBody(request) {
  const chunks = [];
  for await (let chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

console.log("Initializing server...");

const handleRequest = async (req, res) => {
  // Start a new OCR worker. In this simple demo app we do this for every
  // request. In a real application you may want to create a pool of clients
  // which can be re-used across requests, to save needing to re-initialize
  // the worker for each request.
  const client = createOCRClient();

  try {
    const reqURL = new URL(req.url, `http://${req.headers.host}`);
    if (reqURL.pathname !== "/ocr" || req.method !== "POST") {
      res.end(404);
    }

    // Load model concurrently with reading image.
    const modelLoaded = loadModel().then((model) => client.loadModel(model));

    const imageData = await readRequestBody(req);
    const image = await loadImage(imageData);

    await modelLoaded;
    await client.loadImage(image);
    const text = await client.getText();

    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);

    const body = { text };
    res.end(JSON.stringify(body, null, 2));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  } finally {
    // Shut down the OCR worker thread.
    client.destroy();
  }
};

const server = createServer(handleRequest);
const port = 8081;
server.listen(port, () => `Server listening at http://localhost:${port}`);
