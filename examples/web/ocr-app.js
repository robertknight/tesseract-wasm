import classnames from "classnames";
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { OCRClient } from "tesseract-wasm";

function fileFromDropEvent(event) {
  if (!event.dataTransfer) {
    return null;
  }
  for (let i = 0; i < event.dataTransfer.items.length; i++) {
    const item = event.dataTransfer.items[i];
    const file = item.getAsFile();
    if (file) {
      return file;
    }
  }
  return null;
}

function FileDropZone({ onDrop }) {
  const [dragHover, setDragHover] = useState(false);

  return (
    <div
      className={classnames("FileDropZone", { "is-hovered": dragHover })}
      onDragLeave={() => {
        setDragHover(false);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragHover(true);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragHover(false);

        const file = fileFromDropEvent(e);
        if (file) {
          onDrop(file);
        }
      }}
    >
      Drop image here
      <div>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const files = e.target.files;
            if (!files.length) {
              return;
            }
            onDrop(files.item(0));
          }}
        />
      </div>
    </div>
  );
}

function ProgressBar({ value }) {
  return (
    <div className="ProgressBar">
      <div className="ProgressBar__bar" style={{ width: `${value}%` }} />
    </div>
  );
}

function OCRWordBox({ box, imageWidth, imageHeight }) {
  const [hover, setHover] = useState(false);

  const toPercent = (val) => `${val * 100}%`;
  const left = toPercent(box.rect.left / imageWidth);
  const width = toPercent((box.rect.right - box.rect.left) / imageWidth);
  const top = toPercent(box.rect.top / imageHeight);
  const height = toPercent((box.rect.bottom - box.rect.top) / imageHeight);

  return (
    <div
      className="OCRWordBox"
      style={{ position: "absolute", left, top, width, height }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={box.text}
    >
      {hover && (
        <div className="OCRWordBox__content">
          <div className="OCRWordBox__text">{box.text}</div>
        </div>
      )}
    </div>
  );
}

function OCRDemoApp() {
  const ocrClient = useRef(null);
  const [documentImage, setDocumentImage] = useState(null);
  const [documentText, setDocumentText] = useState(null);
  const [error, setError] = useState(null);
  const [ocrProgress, setOCRProgress] = useState(null);
  const [wordBoxes, setWordBoxes] = useState([]);

  const canvasRef = useRef(null);

  useEffect(() => {
    if (!documentImage) {
      return;
    }

    setError(null);
    setWordBoxes(null);

    // Set progress to `0` rather than `null` here to show the progress bar
    // immediately after an image is selected.
    setOCRProgress(0);

    const context = canvasRef.current.getContext("2d");
    context.drawImage(documentImage, 0, 0);

    const doOCR = async () => {
      if (!ocrClient.current) {
        // Initialize the OCR engine when recognition is performed for the first
        // time.
        ocrClient.current = new OCRClient({
          // In a production application, you would serve the tesseract-worker.js
          // and .wasm files from node_modules/tesseract-wasm/dist/ alongside
          // your JS bundle, and setting `workerURL` would not be required.
          workerURL: "node_modules/tesseract-wasm/dist/tesseract-worker.js",
        });

        // Fetch OCR model. In production you would probably want to serve this
        // yourself and ensure that the model is well compressed (eg.  using
        // Brotli) to reduce the download size and cached for a long time.
        await ocrClient.current.loadModel(
          "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata"
        );
      }
      const ocr = ocrClient.current;

      try {
        await ocr.loadImage(documentImage);

        // Perform OCR and display progress.
        let boxes = await ocr.getTextBoxes("word", setOCRProgress);
        boxes = boxes.filter((box) => box.text.trim() !== "");
        setWordBoxes(boxes);

        // Get the text as a single string. This will be quick since OCR has
        // already been performed.
        const text = await ocr.getText();
        setDocumentText(text);
      } catch (err) {
        setError(err);
      } finally {
        setOCRProgress(null);
      }
    };
    doOCR();
  }, [documentImage]);

  const loadImage = async (file) => {
    try {
      const image = await createImageBitmap(file);
      setDocumentImage(image);
    } catch {
      setError(new Error("Could not read document image"));
    }
  };

  return (
    <div className="OCRDemoApp">
      <h1>tesseract-wasm demo</h1>
      {error && (
        <div className="OCRDemoApp__error">
          <b>Error:</b> {error.message}
        </div>
      )}
      <FileDropZone onDrop={loadImage} />
      {ocrProgress !== null && <ProgressBar value={ocrProgress} />}
      {documentImage && (
        <div className="OCRDemoApp__output">
          <canvas
            className="OCRDemoApp__doc-image"
            width={documentImage.width}
            height={documentImage.height}
            ref={canvasRef}
          />
          {wordBoxes && (
            <div className="OCRDemoApp__word-boxes">
              {wordBoxes.map((box, index) => (
                <OCRWordBox
                  key={index}
                  imageWidth={documentImage.width}
                  imageHeight={documentImage.height}
                  box={box}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {documentText && <pre className="OCRDemoApp__text">{documentText}</pre>}
    </div>
  );
}

const container = document.getElementById("app");
const root = createRoot(container);
root.render(<OCRDemoApp />);
