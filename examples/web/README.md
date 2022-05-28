# tesseract-wasm web demo app

## How to run

1. Download the English language text recognition model

   ```sh
   curl -L 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata' -o eng.traineddata
   ```
2. Install packages and build/serve demo

   ```sh
   npm install
   npm run serve
   ```
3. Open http://127.0.0.1:8000/ in your browser
