import nodeResolve from "@rollup/plugin-node-resolve";
import commonJS from "@rollup/plugin-commonjs";
import virtual from "@rollup/plugin-virtual";

export default [
  {
    input: "src/worker.js",
    output: {
      dir: "dist",
      entryFileNames: "tesseract-worker.js",

      // nb. Compiled as a classic script because Firefox and Safari < 15 do
      // not support module workers. See https://caniuse.com/mdn-api_worker_worker_ecmascript_modules.
      format: "umd",
    },
    plugins: [
      // Stub out the Node imports that Emscripten's JS references. It will only
      // try to actually use these in Node.
      virtual({
        child_process: "",
        fs: "",
        path: "",
      }),
      nodeResolve(),
      commonJS(),
    ],
  },
  {
    input: "src/index.js",
    output: {
      dir: "dist",
      entryFileNames: "lib.js",
      format: "esm",
    },
    plugins: [
      // Stub out the Node imports that Emscripten's JS references. It will only
      // try to actually use these in Node.
      virtual({
        child_process: "",
        fs: "",
        path: "",
      }),
      nodeResolve(),
      commonJS(),
    ],
  },
  
];
