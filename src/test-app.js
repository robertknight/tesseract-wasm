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

Promise.all([initOCRLib(), fetchOCRModel(), fetchImage()])
  .then(async ([ocrLib, ocrModel, imageData]) => {
    console.log("OCR model size", ocrModel.length);
    console.log("Image size", imageData.width, imageData.height);

    const { OCREngine } = ocrLib;
    const engine = new OCREngine();
    console.log("Loading OCR model", ocrModel);
    const modelResult = engine.loadModel(ocrModel);
    console.log("Model load result...", modelResult);

    console.log("Extracting text");
    const start = performance.now();
    const result = engine.extractText(
      imageData.data,
      imageData.width,
      imageData.height,
      4 /* bytesPerPixel */,
      imageData.width * 4 /* bytesPerLine */
    );
    const end = performance.now();
    console.log("result", result);
    console.log("OCR time", end - start);
  })
  .catch((err) => {
    console.error("OCR init failed", err);
  });
