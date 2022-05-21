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
ENV.DOTPRODUCT = "sse";
