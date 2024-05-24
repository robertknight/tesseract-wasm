// Type definitions for the Emscripten-generated JS entry point for the
// WASM file.
export default function initTesseractCore(
  options: { wasmBinary?: ArrayBuffer } = {}
): Promise<unknown>;
