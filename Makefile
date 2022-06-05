EMSDK_DIR=$(PWD)/third_party/emsdk/upstream/emscripten
INSTALL_DIR=$(PWD)/install
FALLBACK_INSTALL_DIR=$(INSTALL_DIR)/fallback

DIST_TARGETS=\
  dist/tesseract-core.wasm \
	dist/tesseract-core-fallback.wasm \
	dist/lib.js \
	dist/tesseract-worker.js

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
	node_modules/.bin/prettier -w {examples,src,test}/**/*.js

.PHONY: checkformat
checkformat:
	clang-format -Werror --dry-run --style=google src/*.cpp
	node_modules/.bin/prettier --check {examples,src,test}/**/*.js


.PHONY: typecheck
typecheck:
	node_modules/.bin/tsc

.PHONY: test
test: third_party/tessdata_fast
	node_modules/.bin/mocha

.PHONY: release
release: clean lib typecheck test
	@which np || (echo "Install np from https://github.com/sindresorhus/np" && false)
	np minor

.PHONY: gh-pages
gh-pages:
	./update-gh-pages.sh

EMSDK_COMMIT=93f21c9ef30bab52de24f9d4ea3f2f377cf6326a
third_party/emsdk:
	git clone --depth 1 https://github.com/emscripten-core/emsdk.git $@
	cd $@ && git fetch origin $(EMSDK_COMMIT) && git checkout $(EMSDK_COMMIT)

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

# The Leptonica commit is not a stable release because we need a recent (as of
# 2022-05-22) commit where WEBP and JPEG support is optional.
LEPTONICA_COMMIT=ac9a152c6f2ea048bb10660bacfc66181186b825
third_party/leptonica:
	mkdir -p third_party/leptonica
	git clone --depth 1 https://github.com/DanBloomberg/leptonica.git $@
	cd $@ && git fetch origin $(LEPTONICA_COMMIT) && git checkout $(LEPTONICA_COMMIT)

build/leptonica.uptodate: third_party/leptonica build/emsdk.uptodate
	mkdir -p build/leptonica
	cd build/leptonica && $(EMSDK_DIR)/emcmake cmake -G Ninja ../../third_party/leptonica $(LEPTONICA_FLAGS)
	cd build/leptonica && $(EMSDK_DIR)/emmake ninja
	cd build/leptonica && $(EMSDK_DIR)/emmake ninja install
	touch build/leptonica.uptodate

# Additional preprocessor defines for Tesseract.
#
# Defining `TESSERACT_IMAGEDATA_AS_PIX` disables some unnecessary internal use
# of the PNG format. See Tesseract commit 6bcb941bcff5e73b62ecc8d2aa5691d3e0e7afc0.
TESSERACT_DEFINES=-DTESSERACT_IMAGEDATA_AS_PIX

# Compile flags for Tesseract. These turn off support for unused features and
# utility programs to reduce size and build times.
#
# 128-bit wide SIMD is enabled via `HAVE_SSE4_1` and the `-msimd128` flags. The
# AVX flags are disabled because they require instructions beyond what WASM SIMD
# supports.
TESSERACT_FLAGS=\
  -DBUILD_TESSERACT_BINARY=OFF \
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
  -DCMAKE_CXX_FLAGS="$(TESSERACT_DEFINES) -msimd128" \
  -DCMAKE_INSTALL_PREFIX=$(INSTALL_DIR)

# Compile flags for fallback Tesseract build. This is for browsers that don't
# support WASM SIMD.
TESSERACT_FALLBACK_FLAGS=$(TESSERACT_FLAGS) \
  -DHAVE_SSE4_1=OFF \
	-DCMAKE_INSTALL_PREFIX=$(FALLBACK_INSTALL_DIR) \
  -DCMAKE_CXX_FLAGS=$(TESSERACT_DEFINES)

# Tesseract commit is v5.1.0 plus additional fixes needed to compile against
# the pinned Leptonica version.
TESSERACT_COMMIT=f36c0d019be59cae3b96da0d89d870dbe83e9714
third_party/tesseract:
	mkdir -p third_party/tesseract
	git clone --depth 1 https://github.com/tesseract-ocr/tesseract.git $@
	cd $@ && git fetch origin $(TESSERACT_COMMIT) && git checkout $(TESSERACT_COMMIT)
	cd $@ && git apply ../../patches/tesseract.diff

third_party/tessdata_fast:
	mkdir -p third_party/tessdata_fast
	git clone --depth 1 https://github.com/tesseract-ocr/tessdata_fast.git $@

build/tesseract.uptodate: build/leptonica.uptodate third_party/tesseract
	mkdir -p build/tesseract
	(cd build/tesseract && $(EMSDK_DIR)/emcmake cmake -G Ninja ../../third_party/tesseract $(TESSERACT_FLAGS))
	(cd build/tesseract && $(EMSDK_DIR)/emmake ninja)
	(cd build/tesseract && $(EMSDK_DIR)/emmake ninja install)
	touch build/tesseract.uptodate

build/tesseract-fallback.uptodate: build/leptonica.uptodate third_party/tesseract
	mkdir -p build/tesseract-fallback
	(cd build/tesseract-fallback && $(EMSDK_DIR)/emcmake cmake -G Ninja ../../third_party/tesseract $(TESSERACT_FALLBACK_FLAGS))
	(cd build/tesseract-fallback && $(EMSDK_DIR)/emmake ninja)
	(cd build/tesseract-fallback && $(EMSDK_DIR)/emmake ninja install)
	touch build/tesseract-fallback.uptodate

# emcc flags. `-Os` minifies the JS wrapper and optimises WASM code size.
# We also disable filesystem support to reduce the JS wrapper size.
# Enabling memory growth is important since loading document images may
# require large blocks of memory.
#
# The `ENVIRONMENT` option is set to "web", but the resulting binary can still
# be used in Node, since the Node environment is effectively a superset of the
# relevant web environment.
EMCC_FLAGS =\
  -Os\
  --no-entry\
  -sEXPORT_ES6 \
  -sENVIRONMENT=web \
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

dist/lib.js dist/tesseract-worker.js: src/*.js build/tesseract-core.js build/tesseract-core.wasm build/tesseract-core-fallback.wasm
	node_modules/.bin/rollup -c rollup.config.js
