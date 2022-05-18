import { OCRClient } from "./ocr-client";
import { timeIt } from "./util";

async function fetchImage() {
  const response = await fetch("./test-page.jpg");
  return createImageBitmap(await response.blob());
}

const ocrStatus = document.createElement("div");
document.body.append(ocrStatus);
function updateStatus(status) {
  ocrStatus.textContent = status;
}

const ocrResult = document.createElement("p");
document.body.append(ocrResult);

const ocr = new OCRClient();

Promise.all([timeIt("fetching image", fetchImage)])
  .then(async ([image]) => {
    updateStatus("Loading model");
    await ocr.loadModel("./eng.traineddata");

    updateStatus("Loading image");
    await ocr.loadImage(image);

    updateStatus("Performing OCR...");
    const textWords = await timeIt("getting text words", () =>
      ocr.getTextBoxes("word")
    );
    updateStatus("OCR complete");

    ocrResult.textContent = textWords.map((word) => word.text).join(" ");

    ocr.destroy();
  })
  .catch((err) => {
    updateStatus(`OCR init failed: ${err}`);
  });
