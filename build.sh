#!/bin/sh

set -eu

# Setup emscripten
if [ ! -d "emsdk" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git
  emsdk/emsdk install latest
  emsdk/emsdk activate latest
fi

EMSDK_DIR=$PWD/emsdk/upstream/emscripten
INSTALL_DIR=$PWD/install

# Build Leptonica
# TODO - Check out a specific tag
if [ ! -d "leptonica" ]; then
  git clone --depth 1 https://github.com/DanBloomberg/leptonica.git
fi

mkdir -p build/leptonica
LEPTONICA_FLAGS="
  -DLIBWEBP_SUPPORT=OFF
  -DOPENJPEG_SUPPORT=OFF
  -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR
"

(cd build/leptonica && $EMSDK_DIR/emcmake cmake ../../leptonica $LEPTONICA_FLAGS)
(cd build/leptonica && $EMSDK_DIR/emmake make -j4)
(cd build/leptonica && $EMSDK_DIR/emmake make install)

# Build Tesseract
if [ ! -d "tesseract" ]; then
  git clone --depth 1 https://github.com/tesseract-ocr/tesseract.git
  (cd tesseract && git apply ../patches/tesseract.diff)
fi

mkdir -p build/tesseract
TESSERACT_FLAGS="
  -DBUILD_TRAINING_TOOLS=OFF
  -DDISABLE_CURL=ON
  -DDISABLED_LEGACY_ENGINE=ON
  -DGRAPHICS_DISABLED=ON
  -DHAVE_AVX2=OFF
  -DHAVE_AVX512F=OFF
  -DHAVE_FMA=OFF
  -DLeptonica_DIR=$INSTALL_DIR/lib/cmake/leptonica
  -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR
"

(cd build/tesseract && $EMSDK_DIR/emcmake cmake ../../tesseract $TESSERACT_FLAGS)
(cd build/tesseract && $EMSDK_DIR/emmake make -j4)
(cd build/tesseract && $EMSDK_DIR/emmake make install)

# Build the node test app
# Build the browser test app
