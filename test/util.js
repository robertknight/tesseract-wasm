import { fileURLToPath } from "node:url";

import sharp from "sharp";

/**
 * Resolve a path against the location of the current module.
 *
 * @param {string} path
 */
export function resolve(path, moduleURL = import.meta.url) {
  return fileURLToPath(new URL(path, moduleURL).href);
}

/**
 * Convert a sharp image to an ImageData-like object that can be passed to
 * OCREngine and OCRClient.
 */
export async function toImageData(image) {
  const { width, height } = await image.metadata();
  return {
    data: await image.raw().toBuffer(),
    width,
    height,
  };
}

/**
 * Load and decode an image into an ImageData-like object.
 *
 * @param {string} path
 * @return {ImageData}
 */
export async function loadImage(path) {
  const image = await sharp(path).ensureAlpha();
  return toImageData(image);
}
