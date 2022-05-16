EMSDK_DIR=$(PWD)/third_party/emsdk/upstream/emscripten
INSTALL_DIR=$(PWD)/install

LEPTONICA_FLAGS=\
	-DLIBWEBP_SUPPORT=OFF \
	-DOPENJPEG_SUPPORT=OFF \
	-DCMAKE_INSTALL_PREFIX=$(INSTALL_DIR)

all: build/tesseract.uptodate third_party/tessdata_fast

clean:
	rm -rf build install

build:
	mkdir -p build/

third_party/emsdk:
	git clone --depth 1 https://github.com/emscripten-core/emsdk.git $@

build/emsdk.uptodate: build third_party/emsdk
	third_party/emsdk/emsdk install latest
	third_party/emsdk/emsdk activate latest
	touch build/emsdk.uptodate

third_party/leptonica:
	mkdir -p third_party/leptonica
	git clone --depth 1 https://github.com/DanBloomberg/leptonica.git $@

build/leptonica.uptodate: third_party/leptonica build/emsdk.uptodate
	mkdir -p build/leptonica
	cd build/leptonica && $(EMSDK_DIR)/emcmake cmake ../../third_party/leptonica $(LEPTONICA_FLAGS)
	cd build/leptonica && $(EMSDK_DIR)/emmake make -j4
	cd build/leptonica && $(EMSDK_DIR)/emmake make install
	touch build/leptonica.uptodate

TESSERACT_FLAGS=\
  -DBUILD_TRAINING_TOOLS=OFF \
  -DDISABLE_CURL=ON \
  -DDISABLED_LEGACY_ENGINE=ON \
  -DGRAPHICS_DISABLED=ON \
  -DHAVE_AVX2=OFF \
  -DHAVE_AVX512F=OFF \
  -DHAVE_FMA=OFF \
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
