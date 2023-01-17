# tesseract-wasm

![npm package](https://img.shields.io/npm/v/tesseract-wasm)

A WebAssembly build of the [Tesseract](https://github.com/tesseract-ocr/tesseract)
OCR engine for use in the browser and Node.

tesseract-wasm can detect and recognize text in document images. It supports multiple languages via different [trained models](https://tesseract-ocr.github.io/tessdoc/Data-Files).

👉 [**Try the demo**](https://robertknight.github.io/tesseract-wasm/) (Currently supports English)

## Features

This Tesseract build has been optimized for use in the browser by:

- Stripping functionality which is not needed in a browser environment (eg.
  code to parse various image formats) to reduce download size and improve
  startup performance. The library and English training data require a ~2.1MB
  download (with Brotli compression).

- Using [WebAssembly SIMD](https://v8.dev/features/simd) when available
  (Chrome >= 91, Firefox >= 90, Safari >= 16.3) to improve text
  recognition performance.

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

```js
import { OCRClient } from 'tesseract-wasm';

async function runOCR() {
  // Fetch document image and decode it into an ImageBitmap.
  const imageResponse = await fetch('./test-image.jpg');
  const imageBlob = await imageResponse.blob();
  const image = await createImageBitmap(image);

  // Initialize the OCR engine. This will start a Web Worker to do the
  // work in the background.
  const ocr = new OCRClient();

  try {
    // Load the appropriate OCR training data for the image(s) we want to
    // process.
    await ocr.loadModel('eng.traineddata');

    await ocr.loadImage(someImage);

    // Perform text recognition and return text in reading order.
    const text = await ocr.getText();

    console.log('OCR text: ', text);
  } finally {
    // Once all OCR-ing has been done, shut down the Web Worker and free up
    // resources.
    ocr.destroy();
  }
}

runOCR();
```

## Examples and documentation

See the `examples/` directory for projects that show usage of the library in
the browser and Node.

See the [API documentation](https://robertknight.github.io/tesseract-wasm/api/)
for detailed usage information.

See the Tesseract [User Manual](https://tesseract-ocr.github.io/tessdoc/) for
information on how Tesseract works, as well as advice on [improving
recognition](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).

## Development

### Prerequisites

To build this library locally, you will need:

 - A C++ build toolchain (eg. via the `build-essential` package on Ubuntu or Xcode on macOS)
 - [CMake](https://cmake.org)
 - [Ninja](https://ninja-build.org)

The [Emscripten](https://emscripten.org) toolchain used to compile C++ to
WebAssembly is downloaded as part of the build process.

To install CMake and Ninja:

#### On macOS:

```
brew install cmake ninja
```

#### On Ubuntu

```
sudo apt-get install cmake ninja-build
```

### Building the library

```sh
git clone https://github.com/robertknight/tesseract-wasm
cd tesseract-wasm

# Build WebAssembly binaries and JS library in dist/ folder
make lib

# Run tests
make test
```

To test your local build of the library with the example projects, or your own
projects, you can use [yalc](https://www.npmjs.com/package/yalc).

```sh
# In this project
yalc publish

# In the project where you want to use your local build of tesseract-wasm
yalc link tesseract-wasm
```
