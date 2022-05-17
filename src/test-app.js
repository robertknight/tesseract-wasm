import initOCRLib from "../build/ocr-lib";

async function fetchOCRModel() {
  const response = await fetch("./eng.traineddata");
  const data = await response.arrayBuffer();
  const ary = new Uint8Array(data);
  return ary;
}

async function fetchImage() {
  const response = await fetch("./test-page.jpg");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Create a JS array from a std::vector wrapper created by Embind.
 */
function jsArrayFromStdVector(vec) {
  const size = vec.size();
  const result = [];
  for (let i = 0; i < size; i++) {
    result.push(vec.get(i));
  }
  return result;
}

function timeIt(label, callback) {
  const start = performance.now();
  const result = callback();
  if (typeof result?.then === "function") {
    return result.then((value) => {
      const end = performance.now();
      console.log(`${label} took ${end - start}ms`);
      return value;
    });
  } else {
    const end = performance.now();
    console.log(`${label} took ${end - start}ms`);
    return result;
  }
}

Promise.all([
  timeIt("initializing OCR library", initOCRLib),
  timeIt("fetching OCR model", fetchOCRModel),
  timeIt("fetching image", fetchImage),
])
  .then(async ([ocrLib, ocrModel, imageData]) => {
    const { OCREngine, TextUnit } = ocrLib;
    const engine = new OCREngine();
    const modelResult = timeIt("loading model", () =>
      engine.loadModel(ocrModel)
    );
    if (modelResult !== 0) {
      throw new Error("Failed to load model");
    }

    let result = timeIt("loading image", () =>
      engine.loadImage(
        imageData.data,
        imageData.width,
        imageData.height,
        4 /* bytesPerPixel */,
        imageData.width * 4 /* bytesPerLine */
      )
    );
    if (result !== 0) {
      throw new Error("Failed to load image");
    }

    const textBoxes = timeIt("getting word boxes", () =>
      jsArrayFromStdVector(engine.getBoundingBoxes(TextUnit.Word))
    );
    const textLineBoxes = timeIt("getting line boxes", () =>
      jsArrayFromStdVector(engine.getBoundingBoxes(TextUnit.Line))
    );
    const textLines = timeIt("getting text lines", () =>
      jsArrayFromStdVector(engine.getText(TextUnit.Line))
    );
    const textWords = timeIt("getting text words", () =>
      jsArrayFromStdVector(engine.getText(TextUnit.Word))
    );
  })
  .catch((err) => {
    console.error("OCR init failed", err);
  });
