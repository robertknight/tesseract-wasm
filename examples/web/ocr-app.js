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
      Drop an image here to OCR it
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
          <div className="OCRWordBox__text">
            {box.text} ({box.confidence.toFixed(2)})
          </div>
        </div>
      )}
    </div>
  );
}

function isNormalOrientation(orientation) {
  return orientation.confidence > 0 && orientation.rotation === 0;
}

function formatOrientation(orientation) {
  if (orientation.confidence === 0) {
    return "Unknown";
  }
  return `${orientation.rotation}°`;
}

function OCRDemoApp() {
  const ocrClient = useRef(null);
  const [documentImage, setDocumentImage] = useState(null);
  const [documentText, setDocumentText] = useState(null);
  const [error, setError] = useState(null);
  const [ocrProgress, setOCRProgress] = useState(null);
  const [status, setStatus] = useState(null);
  const [wordBoxes, setWordBoxes] = useState([]);
  const [orientation, setOrientation] = useState(null);
  const [ocrTime, setOCRTime] = useState(null);
  const [outputFormat, setOutputFormat] = useState("text");

  const canvasRef = useRef(null);

  useEffect(() => {
    if (!documentImage) {
      return;
    }

    setError(null);
    setWordBoxes(null);
    setOrientation(null);
    setOCRTime(null);

    // Set progress to `0` rather than `null` here to show the progress bar
    // immediately after an image is selected.
    setOCRProgress(0);

    const context = canvasRef.current.getContext("2d");
    context.drawImage(documentImage, 0, 0);

    let cancelled = false;

    const doOCR = async () => {
      if (!ocrClient.current) {
        // Initialize the OCR engine when recognition is performed for the first
        // time.
        ocrClient.current = new OCRClient();

        // Fetch OCR model. This demo fetches the model directly from GitHub,
        // but in production you should serve it yourself and make sure HTTP
        // compression and caching are applied to reduce loading time.
        setStatus("Fetching text recognition model");
        await ocrClient.current.loadModel(
          "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata",
        );
      }
      const ocr = ocrClient.current;
      const startTime = performance.now();

      try {
        setStatus("Loading image");
        await ocr.loadImage(documentImage);
        if (cancelled) {
          return;
        }

        const orientation = await ocr.getOrientation();
        setOrientation(orientation);

        // Perform OCR and display progress.
        setStatus("Recognizing text");
        let boxes = await ocr.getTextBoxes("word", setOCRProgress);
        boxes = boxes.filter((box) => box.text.trim() !== "");

        if (cancelled) {
          return;
        }
        setWordBoxes(boxes);

        const endTime = performance.now();
        setOCRTime(Math.round(endTime - startTime));

        // Get the text as a single string. This will be quick since OCR has
        // already been performed.
        let text;
        switch (outputFormat) {
          case "hocr":
            text = await ocr.getHOCR();
            break;
          case "text":
            text = await ocr.getText();
            break;
        }

        if (cancelled) {
          return;
        }
        setDocumentText(text);
      } catch (err) {
        setError(err);
      } finally {
        setOCRProgress(null);
        setStatus(null);
      }
    };
    doOCR();

    return () => {
      cancelled = true;
    };
  }, [documentImage, outputFormat]);

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
      <header className="OCRDemoApp__header">
        <h1>tesseract-wasm</h1>
        <div className="u-grow" />
        <a href="https://github.com/robertknight/tesseract-wasm">
          <img
            className="OCRDemoApp__gh-logo"
            src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
          />
        </a>
      </header>
      <p>
        A <a href="https://webassembly.org">WebAssembly</a> build of the{" "}
        <a href="https://github.com/tesseract-ocr/tesseract">Tesseract</a> OCR
        engine for use in the browser and Node. It detects and recognizes text
        in document images.
      </p>
      <p>
        This build has been optimized for modern browsers by using{" "}
        <a href="https://v8.dev/features/simd">WebAssembly SIMD</a> (where
        available) to speed up the neural network used for text recognition.
        Code which duplicates browser functionality (eg. parsing of various
        image formats) has been stripped out to reduce download size.
      </p>
      <p>
        See the{" "}
        <a href="https://github.com/robertknight/tesseract-wasm">
          project README
        </a>{" "}
        for usage instructions and examples. Choose an image in the picker below
        to see it in action. Note that Tesseract is designed to work with
        reasonably clean document images/photos rather than scenes containing
        text. For advice on improving recognition, see the{" "}
        <a href="https://tesseract-ocr.github.io">Tesseract User Manual</a>.
      </p>
      {error && (
        <div className="OCRDemoApp__error">
          <b>Error:</b> {error.message}
        </div>
      )}
      <FileDropZone onDrop={loadImage} />
      <div>
        <label htmlFor="output-format">Output format:</label>
        <select
          id="output-format"
          onChange={(e) => setOutputFormat(e.target.value)}
          value={outputFormat}
        >
          <option value="text">Plain text</option>
          <option value="hocr">hOCR</option>
        </select>
      </div>
      {status !== null && <div>{status}…</div>}
      {ocrTime !== null && (
        <div>
          Found {wordBoxes.length} words in {ocrTime}ms
        </div>
      )}
      {ocrProgress !== null && <ProgressBar value={ocrProgress} />}
      {orientation !== null &&
        !isNormalOrientation(orientation) &&
        `Orientation: ${formatOrientation(orientation)}`}
      {documentImage && (
        <div className="OCRDemoApp__output">
          <canvas
            className="OCRDemoApp__doc-image"
            width={documentImage.width}
            height={documentImage.height}
            ref={canvasRef}
          />
          {wordBoxes && (
            <div
              className="OCRDemoApp__word-boxes"
              style={{
                // The browser will implicitly set aspect-ratio for the <canvas>
                // based on its `width` and `height` properties. For the word
                // box layer we must provide it ourselves.
                //
                // This requires a modern browser (>= Sept 2021). In older browsers
                // you could use JS or a padding hack (https://css-tricks.com/aspect-ratio-boxes/).
                aspectRatio: `auto ${documentImage.width}/${documentImage.height}`,
              }}
            >
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
