# tesseract-wasm Node server demo

This demo uses the high-level `OCRClient` API to perform OCR in HTTP requests.

## Usage

Install dependencies and start the server:

```sh
npm install
node ocr-server.js
```

To run OCR on an image and receive the results as JSON:

```
curl --data-binary @some-image.jpg http://localhost:8081/ocr
```
