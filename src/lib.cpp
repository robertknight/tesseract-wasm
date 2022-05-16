#include <emscripten/emscripten.h>
#include <tesseract/baseapi.h>
#include <leptonica/allheaders.h>

#include <memory>
#include <string>

class OCREngine {
public:
  OCREngine()
    : m_tesseract(new tesseract::TessBaseAPI())
  {
  }

  ~OCREngine() {
    m_tesseract->End();
  }

  const char* Version() const {
    return m_tesseract->Version();
  }

  bool Init() {
    // TODO - Pass in training data
    return m_tesseract->Init(NULL, "eng");
  }

  std::string Run(const char* image_data, int image_len) {
    // TODO - Convert image to `Pix`

    // Open input image with leptonica library
    /* Pix *image = pixRead("/usr/src/tesseract/testing/phototest.tif"); */
    /* api->SetImage(image); */
    // Get OCR result
    auto outText = m_tesseract->GetUTF8Text();
    delete[] outText;

    return "dummy result";
    // Destroy used object and release memory
    /* api->End(); */
    /* delete api; */
    /* delete [] outText; */
    /* pixDestroy(&image); */
  }

  private:
    std::unique_ptr<tesseract::TessBaseAPI> m_tesseract;
};

#define OCRLIB_EXPORT extern "C"

OCRLIB_EXPORT OCREngine* EMSCRIPTEN_KEEPALIVE OCREngine_Create() {
  auto engine = new OCREngine();
  engine->Init();
  return engine;
}

OCRLIB_EXPORT const char* EMSCRIPTEN_KEEPALIVE OCREngine_Version(OCREngine* engine) {
  return engine->Version();
}

OCRLIB_EXPORT void EMSCRIPTEN_KEEPALIVE OCREngine_Destroy(OCREngine* engine) {
  delete engine;
}

OCRLIB_EXPORT void EMSCRIPTEN_KEEPALIVE OCREngine_Run(OCREngine* engine, const char* image_data, int image_len) {
  engine->Run(image_data, image_len);
}
