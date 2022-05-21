import { OCRClient } from "../";

const client = new OCRClient({ workerURL: "../dist/worker.js" });
/** @type {Promise<void>} */
let modelLoaded;

/**
 * @param {ImageBitmap} image
 * @return {Promise<void>}
 */
async function ocrImage(image) {
  if (!modelLoaded) {
    modelLoaded = client.loadModel(
      "../third_party/tessdata_fast/eng.traineddata"
    );
  }
  await modelLoaded;

  try {
    await client.loadImage(image);
    const boxes = await client.getBoundingBoxes("word");

    updateStatus(`Performing OCR (${boxes.length} words)...`);
    const textWords = await client.getTextBoxes("word");
    updateStatus("OCR complete");

    ocrResult.textContent = textWords.map((word) => word.text).join(" ");
  } catch (err) {
    updateStatus(`OCR failed: ${err}`);
  }
}

const dropZone = document.createElement("div");
dropZone.style.cssText = "width: 200px; height: 200px; border: 2px solid black";
dropZone.textContent = "Drop image to OCR";

/** @param {DragEvent} e */
dropZone.ondrop = async (e) => {
  if (!e.dataTransfer) {
    return;
  }
  e.preventDefault();

  const ocrDone = [];
  for (let i = 0; i < e.dataTransfer.items.length; i++) {
    const item = e.dataTransfer.items[i];
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    const done = createImageBitmap(file).then(ocrImage);
    ocrDone.push(done);
  }
  await Promise.all(ocrDone);
  updateStatus(`OCR complete for ${ocrDone.length} images`);
};

/** @param {DragEvent} e */
dropZone.ondragover = (e) => e.preventDefault();

const ocrStatus = document.createElement("div");
document.body.append(ocrStatus);

/** @param {string} status */
function updateStatus(status) {
  ocrStatus.textContent = status;
}

document.body.append(dropZone);

const ocrResult = document.createElement("p");
document.body.append(ocrResult);
