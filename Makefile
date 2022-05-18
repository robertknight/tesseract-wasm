EMSDK_DIR=$(PWD)/third_party/emsdk/upstream/emscripten
INSTALL_DIR=$(PWD)/install

all: build/tesseract.uptodate third_party/tessdata_fast

clean:
	rm -rf build install

# nb. This is an order-only dependency in other targets.
build:
	mkdir -p build/

.PHONY: format
format:
	clang-format -i --style=google src/*.cpp

third_party/emsdk:
	git clone --depth 1 https://github.com/emscripten-core/emsdk.git $@

build/emsdk.uptodate: third_party/emsdk | build
	third_party/emsdk/emsdk install latest
	third_party/emsdk/emsdk activate latest
	touch build/emsdk.uptodate

# Compile flags for Leptonica. These turn off support for various image formats to
# reduce size. We don't need this since the browser includes this functionality.
LEPTONICA_FLAGS=\
	-DLIBWEBP_SUPPORT=OFF \
	-DOPENJPEG_SUPPORT=OFF \
	-DCMAKE_INSTALL_PREFIX=$(INSTALL_DIR)

third_party/leptonica:
	mkdir -p third_party/leptonica
	git clone --depth 1 https://github.com/DanBloomberg/leptonica.git $@

build/leptonica.uptodate: third_party/leptonica build/emsdk.uptodate
	mkdir -p build/leptonica
	cd build/leptonica && $(EMSDK_DIR)/emcmake cmake ../../third_party/leptonica $(LEPTONICA_FLAGS)
	cd build/leptonica && $(EMSDK_DIR)/emmake make -j4
	cd build/leptonica && $(EMSDK_DIR)/emmake make install
	touch build/leptonica.uptodate

# Compile flags for Tesseract. These turn off support for unused features and
# utility programs to reduce size and build times.
#
# We also turn off support for vector processing instructions because
# EMCC/WASM doesn't support those. In browsers that support WebAssembly SIMD,
# it is possible to use a Tesseract build with `HAVE_SSE4_1` enabled. This will
# significantly improve performance, but a non-SIMD build would be needed for
# older browsers. In addition to enabling `HAVE_SSE4_1` here, enabling SSE will
# require changes to `SIMDDetect` in Tesseract to ensure that the SSE versions
# of operations are actually used. Also the `-msimd128` compile flag needs to
# be added to source files compiled with `-msse4.1` to avoid an error from
# emcc. See https://github.com/emscripten-core/emscripten/issues/12714.
TESSERACT_FLAGS=\
  -DBUILD_TRAINING_TOOLS=OFF \
  -DDISABLE_CURL=ON \
  -DDISABLED_LEGACY_ENGINE=ON \
  -DENABLE_LTO=ON \
  -DGRAPHICS_DISABLED=ON \
  -DHAVE_AVX2=OFF \
  -DHAVE_AVX512F=OFF \
  -DHAVE_FMA=OFF \
  -DHAVE_SSE4_1=OFF \
  -DLeptonica_DIR=$(INSTALL_DIR)/lib/cmake/leptonica \
  -DCMAKE_INSTALL_PREFIX=$(INSTALL_DIR)

third_party/tesseract:
	mkdir -p third_party/tesseract
	git clone --depth 1 https://github.com/tesseract-ocr/tesseract.git $@
	(cd third_party/tesseract && git apply ../../patches/tesseract.diff)

third_party/tessdata_fast:
	mkdir -p third_party/tessdata_fast
	git clone --depth 1 https://github.com/tesseract-ocr/tessdata_fast.git $@

build/tesseract.uptodate: build/leptonica.uptodate third_party/tesseract
	mkdir -p build/tesseract
	(cd build/tesseract && $(EMSDK_DIR)/emcmake cmake ../../third_party/tesseract $(TESSERACT_FLAGS))
	(cd build/tesseract && $(EMSDK_DIR)/emmake make -j4)
	(cd build/tesseract && $(EMSDK_DIR)/emmake make install)
	touch build/tesseract.uptodate

# emcc flags. `-Os` minifies the JS wrapper and optimises WASM code size.
# We also disable filesystem support to reduce the JS wrapper size.
# Enabling memory growth is important since loading document images may
# require large blocks of memory.
EMCC_FLAGS =\
  -Os \
  -sEXPORT_ES6 \
  -sFILESYSTEM=0 \
  -sMODULARIZE=1 \
  -sALLOW_MEMORY_GROWTH \
  -sMAXIMUM_MEMORY=128MB

build/ocr-lib.js: src/lib.cpp build/tesseract.uptodate
	$(EMSDK_DIR)/emcc src/lib.cpp $(EMCC_FLAGS) \
		-Iinstall/include/ -Linstall/lib/ -ltesseract -lleptonica -lembind \
		-o $@

build/test-app.js: src/test-app.js build/ocr-lib.js
	node_modules/.bin/rollup -c rollup-test-app.config.js
