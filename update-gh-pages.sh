#!/bin/sh

set -eu

branch_name=$(git symbolic-ref --short HEAD)
if [ "$branch_name" != "gh-pages" ]; then
  echo "Run this script on the gh-pages branch"
  exit 1
fi

# Make sure we're building with the latest version of the lib and example app
git fetch
git reset --hard origin/main

# Do a clean build of the web demo app
(cd examples/web && rm -rf node_modules && npm ci && npm run build)

# Copy resources to the docs/ folder, which GitHub Pages is served from
rm -rf docs/
mkdir -p docs/
cp -R examples/web/index.html examples/web/ocr-app.css examples/web/build docs/
cp examples/web/node_modules/tesseract-wasm/dist/tesseract-* docs/build/

# Commit updated build.
git add docs
git commit -m "Update GitHub Pages"
echo 'GitHub Pages build updated. Run `git push origin --force HEAD` to update the live site.'
