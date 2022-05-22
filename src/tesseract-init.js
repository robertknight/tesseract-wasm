// @ts-nocheck
//
// JavaScript appended to the emscripten-generated runtime for the WASM
// file via the `--post-js` emcc option.
//
// This has the ability to set environment variables before the code loads
// via `ENV`. See https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html#environment-variables.

// Tesseract's CPU feature detection relies on cpuid which isn't available in
// the Emscripten environment, so it will default to the slow generic version
// of certain operations which doesn't use any SIMD instructions.
//
// When WASM SIMD is supported, we can force use of the SSE version of
// instructions via the `DOTPRODUCT` env var. See `SIMDDetect` in Tesseract.
//
// This must be set before the WASM binary is loaded, so we can't use `setenv`
// in the C++ code.

function wasmSIMDSupported() {
  // Tiny WebAssembly file generated from the following source using the wat2wasm
  // tool.
  //
  // (module
  //   (func (result v128)
  //     i32.const 0
  //     i8x16.splat
  //     i8x16.popcnt
  //   )
  // )
  const simdTest = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
    8, 0, 65, 0, 253, 15, 253, 98, 11,
  ]);
  return WebAssembly.validate(simdTest);
}

if (wasmSIMDSupported()) {
  ENV.DOTPRODUCT = "sse";
}
