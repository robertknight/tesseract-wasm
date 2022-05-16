#include <emscripten/bind.h>
#include <emscripten/emscripten.h>
#include <leptonica/allheaders.h>
#include <tesseract/baseapi.h>

#include <memory>
#include <string>
#include <vector>

using namespace emscripten;

class OCREngine {
 public:
  OCREngine() : m_tesseract(new tesseract::TessBaseAPI()) {}

  ~OCREngine() { m_tesseract->End(); }

  std::string Version() const { return m_tesseract->Version(); }

  // TODO - Replace int result with something meaningful
  int LoadModel(const std::string& model_data) {
    std::vector<std::string> vars_vec;
    std::vector<std::string> vars_values;

    auto result = m_tesseract->Init(
        model_data.data(), model_data.size(), "eng", tesseract::OEM_DEFAULT,
        nullptr /* configs */, 0 /* configs_size */, nullptr /* vars_vec */,
        nullptr /* vars_values */, false /* set_only_non_debug_params */,
        nullptr /* reader */
    );

    return result;
  }

  std::string ExtractText(const std::string& image_data, int width, int height,
                          int bytes_per_pixel, int bytes_per_line) {
    // TODO - Sanity check values
    m_tesseract->SetImage(
        reinterpret_cast<const unsigned char*>(image_data.data()), width,
        height, bytes_per_pixel, bytes_per_line);
    m_tesseract->SetRectangle(0, 0, width, height);

    m_tesseract->Recognize(nullptr /* monitor */);
    return std::string(m_tesseract->GetUTF8Text());
  }

 private:
  std::unique_ptr<tesseract::TessBaseAPI> m_tesseract;
};

#define OCRLIB_EXPORT extern "C"

EMSCRIPTEN_BINDINGS(ocrlib) {
  class_<OCREngine>("OCREngine")
      .constructor<>()
      .function("loadModel", &OCREngine::LoadModel)
      .function("extractText", &OCREngine::ExtractText);
}
