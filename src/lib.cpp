#include <emscripten/bind.h>
#include <emscripten/emscripten.h>
#include <leptonica/allheaders.h>
#include <tesseract/baseapi.h>

#include <memory>
#include <string>
#include <vector>

struct IntRect {
  int left = 0;
  int right = 0;
  int top = 0;
  int bottom = 0;
};

struct TextRect {
  IntRect rect;
  std::string text;
};

enum class TextUnit {
  Word,
  Line,
};

template <class T>
std::unique_ptr<T> unique_from_raw(T* ptr) {
  return std::unique_ptr<T>(ptr);
}

std::string string_from_raw(char* ptr) {
  auto result = std::string(ptr);
  delete[] ptr;
  return result;
}

auto iterator_level_from_unit(TextUnit unit) {
  tesseract::PageIteratorLevel level;
  if (unit == TextUnit::Line) {
    return tesseract::RIL_TEXTLINE;
  } else if (unit == TextUnit::Word) {
    return tesseract::RIL_WORD;
  } else {
    return tesseract::RIL_SYMBOL;
  }
}

using namespace emscripten;

class OCREngine {
 public:
  OCREngine() : tesseract_(new tesseract::TessBaseAPI()) {}

  ~OCREngine() { tesseract_->End(); }

  std::string Version() const { return tesseract_->Version(); }

  // TODO - Replace int result with something meaningful
  int LoadModel(const std::string& model_data) {
    std::vector<std::string> vars_vec;
    std::vector<std::string> vars_values;

    auto result = tesseract_->Init(
        model_data.data(), model_data.size(), "eng", tesseract::OEM_DEFAULT,
        nullptr /* configs */, 0 /* configs_size */, nullptr /* vars_vec */,
        nullptr /* vars_values */, false /* set_only_non_debug_params */,
        nullptr /* reader */
    );

    return result;
  }

  // TODO - Replace int result with something meaningful
  int LoadImage(const std::string& image_data, int width, int height,
                int bytes_per_pixel, int bytes_per_line) {
    auto min_buffer_len = height * bytes_per_line;
    if (image_data.size() < min_buffer_len) {
      return -1;
    }

    tesseract_->SetImage(
        reinterpret_cast<const unsigned char*>(image_data.data()), width,
        height, bytes_per_pixel, bytes_per_line);
    tesseract_->SetRectangle(0, 0, width, height);

    layout_analysis_done_ = false;
    ocr_done_ = false;

    return 0;
  }

  std::vector<IntRect> GetBoundingBoxes(TextUnit unit) {
    if (!layout_analysis_done_) {
      tesseract_->AnalyseLayout();
      layout_analysis_done_ = true;
    }
    auto iter = unique_from_raw(tesseract_->GetIterator());
    iter->Begin();

    auto level = iterator_level_from_unit(unit);
    std::vector<IntRect> boxes;
    while (iter->Next(level)) {
      IntRect rect;
      iter->BoundingBox(level, &rect.left, &rect.top, &rect.right,
                        &rect.bottom);
      boxes.push_back(rect);
    }

    return boxes;
  }

  std::vector<TextRect> GetTextBoxes(TextUnit unit) {
    DoOCR();
    auto iter = unique_from_raw(tesseract_->GetIterator());

    auto level = iterator_level_from_unit(unit);

    std::vector<TextRect> boxes;
    while (iter->Next(level)) {
      auto text = string_from_raw(iter->WordNormedUTF8Text());
      TextRect tr;
      tr.text = text;
      iter->BoundingBox(level, &tr.rect.left, &tr.rect.top, &tr.rect.right,
                        &tr.rect.bottom);
      boxes.push_back(tr);
    }

    return boxes;
  }

  std::string GetText() {
    DoOCR();
    return string_from_raw(tesseract_->GetUTF8Text());
  }

 private:
  void DoOCR() {
    if (!ocr_done_) {
      tesseract_->Recognize(nullptr /* monitor */);
      ocr_done_ = true;
    }
  }

  bool layout_analysis_done_ = false;
  bool ocr_done_ = false;
  std::unique_ptr<tesseract::TessBaseAPI> tesseract_;
};

EMSCRIPTEN_BINDINGS(ocrlib) {
  value_object<IntRect>("IntRect")
      .field("left", &IntRect::left)
      .field("top", &IntRect::top)
      .field("right", &IntRect::right)
      .field("bottom", &IntRect::bottom);

  value_object<TextRect>("TextRect")
      .field("rect", &TextRect::rect)
      .field("text", &TextRect::text);

  class_<OCREngine>("OCREngine")
      .constructor<>()
      .function("loadModel", &OCREngine::LoadModel)
      .function("loadImage", &OCREngine::LoadImage)
      .function("getBoundingBoxes", &OCREngine::GetBoundingBoxes)
      .function("getTextBoxes", &OCREngine::GetTextBoxes)
      .function("getText", &OCREngine::GetText);

  enum_<TextUnit>("TextUnit")
      .value("Line", TextUnit::Line)
      .value("Word", TextUnit::Word);

  register_vector<IntRect>("vector<IntRect>");
  register_vector<TextRect>("vector<TextRect>");
}
