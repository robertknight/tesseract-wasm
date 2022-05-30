#!/bin/sh

for example in $(ls examples/)
do
  example_path="examples/$example"
  echo "Updating $example_path"
  (cd "$example_path" && npm install --save tesseract-wasm@latest)
done
