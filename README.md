# tesseract-wasm

A WebAssembly build of the [Tesseract](https://github.com/tesseract-ocr/tesseract)
OCR library for use in the browser.

## Features

This build has been optimized for use in the browser by:

- Stripping functionality which is not needed in a browser environment (eg.
  code to parse various image formats) to reduce download size and improve
  startup performance. The library and English training data require a ~2.1MB
  download (using Brotli compression).

- Using [WebAssembly SIMD](https://v8.dev/features/simd) when available (Chrome
  >= 91, Firefox >= 90, Safari ??) to improve text recognition performance.

- Providing a high-level API that can be used to run web pages without blocking
  interaction and a low-level API that provides more control over execution.

## Setup

1. Add the tesseract-wasm library to your project:

   ```sh
   npm install tesseract-wasm
   ```

2. Serve the `tesseract-core.wasm`, `tesseract-core-fallback.wasm` and
   `tesseract-worker.js` files from `node_modules/tesseract-wasm/dist` alongside
   your JavaScript bundle.

3. Get the training data file(s) for the languages you want to support from the
   [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) repo and
   serve it from a URL that your JavaScript can load. The `eng.traineddata`
   file supports English for example, and also works with many documents in
   other languages that use the same script.

## Usage

tesseract-wasm provides two APIs: a high-level asynchronous API (`OCRClient`)
and a lower-level synchronous API (`OCREngine`). The high-level API is the most
convenient way to run OCR on an image in a web page. It handles running the OCR
engine inside a Web Worker to avoid blocking page interaction. The low-level API
is useful if more control is needed over where/how the code runs and has lower
latency per API call.

### Using OCRClient in a web page

```html
import { OCRClient } from 'tesseract-wasm';

async function runOCR() {
  // Fetch the image to OCR from somewhere and load it into an `ImageBitmap`.
  const imageResponse = await fetch('./test-image.jpg');
  const imageBlob = await imageResponse.blob();
  const image = await createImageBitmap(image);

  const ocr = new OCRClient();
  try {
    // Load the OCR training data for the language or script to support.
    // This only needs to be called once before processing the first image.
    await ocr.loadModel('eng.traineddata');

    // Load the image into the Tesseract library for analysis.
    await ocr.loadImage(someImage);

    // Perform layout analysis and OCR and read the text.
    const textBoxes = await ocr.getTextBoxes('word');
    const text = textBoxes.map(box => box.text).join(' ');

    console.log('OCR text: ', text);
  } finally {
    // Once all OCR-ing has been done, shut down the Web Worker where Tesseract
    // is running to free up resources.
    ocr.destroy();
  }
}

runOCR();
```

## Examples

See the `examples/` directory for projects that show usage of the library.

## Development

To build this library locally, you will need C++ development tools installed
(make, cmake).

```sh
git clone https://github.com/robertknight/tesseract-wasm
cd tesseract-wasm

# Build WASM binary and JS runtime in dist/ folder
make lib

# Build example projects
make examples
```
