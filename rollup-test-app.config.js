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
    virtual({
      fs: "",
      path: "",
    }),
    nodeResolve(),
    commonJS(),
  ],
};
