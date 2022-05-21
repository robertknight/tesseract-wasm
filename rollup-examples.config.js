import nodeResolve from "@rollup/plugin-node-resolve";
import commonJS from "@rollup/plugin-commonjs";

export default [
  {
    input: "examples/test-app.js",
    output: {
      dir: "build/",
      entryFileNames: "[name].js",
      format: "esm",
    },
    plugins: [
      nodeResolve(),
      commonJS(),
    ],
  },
];
