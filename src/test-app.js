import initOCRLib from '../build/ocr-lib';

initOCRLib().then(ocr => {
  console.log('Runtime lib initialized');
  const engine = ocr.ccall("OCREngine_Create", "number");
  const version = ocr.ccall("OCREngine_Version", "string", ["number"], engine);
  console.log(`Tesseract version ${version}`);
  ocr.ccall("OCREngine_Destroy", "void", ["number"], engine);
}).catch(err => {
  console.error('OCR init failed', err);
});

// ocr.onAbort = (...args) => {
//   console.log('Error initializing OCR', args);
// };

// console.log('Bundle entry');
// ocr.onRuntimeInitialized = () => {
//   console.log('Runtime lib initialized');
//   const engine = ocr.ccall("OCREngine_Create", "number");
//   const version = ocr.ccall("OCREngine_Version", "string", ["number"], engine);
//   console.log(`Tesseract version ${version}`);
//   ocr.ccall("OCREngine_Destroy", "void", ["number"], engine);
// };
