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
 * @param {string} path
 */
export async function loadImage(path) {
  const image = await sharp(path).ensureAlpha();
  const { width, height } = await image.metadata();
  return {
    data: await image.raw().toBuffer(),
    width,
    height,
  };
}
