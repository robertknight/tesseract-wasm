import nodeResolve from "@rollup/plugin-node-resolve";
import commonJS from "@rollup/plugin-commonjs";
import virtual from "@rollup/plugin-virtual";

export default {
  input: "src/test-app.js",
  output: {
    dir: "build/",
    entryFileNames: "[name].js",
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
};
