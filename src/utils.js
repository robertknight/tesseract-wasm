/**
 * @param {ImageBitmap} bitmap
 * @return {ImageData}
 */
export function imageDataFromBitmap(bitmap) {
  /** @type {HTMLCanvasElement} */
  let canvas;
  // @ts-expect-error - OffscreenCanvas API is missing
  if (typeof OffscreenCanvas !== "undefined") {
    // @ts-expect-error - OffscreenCanvas API is missing
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  } else if (typeof HTMLCanvasElement !== "undefined") {
    const canvasEl = document.createElement("canvas");
    canvasEl.width = bitmap.width;
    canvasEl.height = bitmap.height;
    canvas = canvasEl;
  } else {
    throw new Error("No canvas implementation available");
  }

  const context = /** @type {CanvasRenderingContext2D} */ (
    canvas.getContext("2d")
  );
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}
