# tesseract-wasm

A WebAssembly build of the [Tesseract](https://github.com/tesseract-ocr/tesseract)
OCR library for use in the browser.

## Features

 - Optimized for size. Tesseract and its dependencies have been stripped of
   functionality which is not needed in a browser environment to reduce library
   size.

   The library is ~550KB after Brotli compression. Together with English
   training data the total download size is ~2.1MB (Brotli compressed).

 - Optimized for speed. tesseract-wasm uses [WebAssembly
   SIMD](https://v8.dev/features/simd) when available (Chrome >= 91, Firefox >=
   90, Safari ??) for faster text recognition.

 - High and low-level APIs. tesseract-wasm provides a convenient high-level API
   for use in a web page and a low-level API that provides more control over
   execution.
 
## Setup

1. Add the tesseract-wasm library to your projects:

   ```sh
   npm install tesseract-wasm
   ```

2. Serve the `.wasm` and `worker.js` files from `node_modules/tesseract-wasm/dist`
   alongside your JavaScript bundle.

3. Get the training data file(s) for the languages you want to support from the
   [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) repo and
   serve it from a URL that your JavaScript can load. The `eng.traineddata`
   file supports English for example, and also works with many documents in
   other languages that use the same script.

## Usage

tesseract-wasm provides two APIs: a high-level asynchronous API (`OCRClient`)
and a lower-level synchronous API (`OCREngine`). The high-level API is the
most convenient way to run OCR on an image in a web page. The low-level API
is useful if more control is needed over where/how the code runs and has lower
latency per API call.

### Using OCRClient

```html
import { OCRClient } from 'tesseract-wasm';

async function getText() {
  // Fetch the image to OCR from somewhere and load it into an `ImageBitmap`.
  const imageResponse = await fetch('./test-image.jpg');
  const imageBlob = await imageResponse.blob();
  const image = await createImageBitmap(image);

  const ocr = new OCRClient();
  try {
    // Load the OCR training data for the language or script to support.
    await ocr.loadModel('eng.traineddata');

    // Load the image into the Tesseract library for analysis.
    await ocr.loadImage(someImage);

    // Perform layout analysis and OCR and read the text.
    const textBoxes = await ocr.getTextBoxes('word');
    return textBoxes.map(box => box.text).join(' ');
  } finally {
    // Shut down the Web Worker where Tesseract is running and free up resources.
    ocr.destroy();
  }
}
```

### Using OCREngine

OCREngine is a low-level API that should not be directly used in a web page, as
it will block interaction while performing OCR. It may be useful however if you
want to manage setting up Web Workers or a different execution environment
yourself.

```js
import { createOCREngine } from 'tesseract-wasm';

async function getText(imageBuffer) {
  const ocr = await createOCREngine(imageBuffer);
  ocr.loadModel(modelBuffer);
  ocr.loadImage(imageBuffer);
  return ocr.getTextBoxes('word');
}
```
