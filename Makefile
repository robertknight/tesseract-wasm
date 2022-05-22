EMSDK_DIR=$(PWD)/third_party/emsdk/upstream/emscripten
INSTALL_DIR=$(PWD)/install
FALLBACK_INSTALL_DIR=$(INSTALL_DIR)/fallback

DIST_TARGETS=dist/tesseract-core.wasm dist/tesseract-core-fallback.wasm dist/lib.js dist/worker.js

.PHONY: lib
lib: $(DIST_TARGETS)

clean:
	rm -rf build dist install

clean-lib:
	rm build/*.{js,wasm}
	rm -rf dist

# nb. This is an order-only dependency in other targets.
build:
	mkdir -p build/

.PHONY: format
format:
	clang-format -i --style=google src/*.cpp
	node_modules/.bin/prettier -w {examples,src}/**/*.js

.PHONY: checkformat
checkformat:
	clang-format -Werror --dry-run --style=google src/*.cpp
	node_modules/.bin/prettier --check {examples,src}/**/*.js

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
# 128-bit wide SIMD is enabled via `HAVE_SSE4_1` and the `-msimd128` flags. The
# AVX flags are disabled because they require instructions beyond what WASM SIMD
# supports.
TESSERACT_FLAGS=\
  -DBUILD_TRAINING_TOOLS=OFF \
  -DDISABLE_CURL=ON \
  -DDISABLED_LEGACY_ENGINE=ON \
  -DENABLE_LTO=ON \
  -DGRAPHICS_DISABLED=ON \
  -DHAVE_AVX=OFF \
  -DHAVE_AVX2=OFF \
  -DHAVE_AVX512F=OFF \
  -DHAVE_FMA=OFF \
  -DHAVE_SSE4_1=ON \
  -DLeptonica_DIR=$(INSTALL_DIR)/lib/cmake/leptonica \
  -DCMAKE_CXX_FLAGS=-msimd128 \
  -DCMAKE_INSTALL_PREFIX=$(INSTALL_DIR)

# Compile flags for fallback Tesseract build. This is for browsers that don't
# support WASM SIMD.
TESSERACT_FALLBACK_FLAGS=$(TESSERACT_FLAGS) \
  -DHAVE_SSE4_1=OFF \
	-DCMAKE_INSTALL_PREFIX=$(FALLBACK_INSTALL_DIR) \
  -DCMAKE_CXX_FLAGS=

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

build/tesseract-fallback.uptodate: build/leptonica.uptodate third_party/tesseract
	mkdir -p build/tesseract-fallback
	(cd build/tesseract-fallback && $(EMSDK_DIR)/emcmake cmake ../../third_party/tesseract $(TESSERACT_FALLBACK_FLAGS))
	(cd build/tesseract-fallback && $(EMSDK_DIR)/emmake make -j4)
	(cd build/tesseract-fallback && $(EMSDK_DIR)/emmake make install)
	touch build/tesseract-fallback.uptodate

# emcc flags. `-Os` minifies the JS wrapper and optimises WASM code size.
# We also disable filesystem support to reduce the JS wrapper size.
# Enabling memory growth is important since loading document images may
# require large blocks of memory.
EMCC_FLAGS =\
  -Os\
  --no-entry\
  -sFILESYSTEM=0 \
  -sMODULARIZE=1 \
  -sALLOW_MEMORY_GROWTH\
  -sMAXIMUM_MEMORY=128MB \
  --post-js=src/tesseract-init.js

# Build main WASM binary for browsers that support WASM SIMD.
build/tesseract-core.js build/tesseract-core.wasm: src/lib.cpp build/tesseract.uptodate
	$(EMSDK_DIR)/emcc src/lib.cpp $(EMCC_FLAGS) \
		-I$(INSTALL_DIR)/include/ -L$(INSTALL_DIR)/lib/ -ltesseract -lleptonica -lembind \
		-o build/tesseract-core.js
	cp src/tesseract-core.d.ts build/

# Build fallback WASM binary for browsers that don't support WASM SIMD. The JS
# output from this build is not used.
build/tesseract-core-fallback.js build/tesseract-core-fallback.wasm: src/lib.cpp build/tesseract-fallback.uptodate
	$(EMSDK_DIR)/emcc src/lib.cpp $(EMCC_FLAGS) \
		-I$(INSTALL_DIR)/include/ -L$(FALLBACK_INSTALL_DIR)/lib/ -L$(INSTALL_DIR)/lib -ltesseract -lleptonica -lembind \
		-o build/tesseract-core-fallback.js

dist/tesseract-core.wasm: build/tesseract-core.wasm
	mkdir -p dist/
	cp $< $@

dist/tesseract-core-fallback.wasm: build/tesseract-core-fallback.wasm
	mkdir -p dist/
	cp $< $@

dist/lib.js dist/worker.js: src/*.js build/tesseract-core.js build/tesseract-core.wasm build/tesseract-core-fallback.wasm
	node_modules/.bin/rollup -c rollup.config.js

.PHONY: examples
examples: examples/*.js
	node_modules/.bin/rollup -c rollup-examples.config.js
