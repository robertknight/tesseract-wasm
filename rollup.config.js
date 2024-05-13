import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default [
  {
    input: "src/index.ts",
    output: {
      dir: "dist",
      entryFileNames: "lib.js",
      format: "esm",
    },
    plugins: [
      typescript(),
      nodeResolve(),
    ],
  },
];
