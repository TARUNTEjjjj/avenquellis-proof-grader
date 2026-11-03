#include "json_api.hpp"

#include <algorithm>
#include <string>

// One synchronous call per instance. The returned buffer lasts until clear or the next call.
namespace { std::string result; }
extern "C" const char* veyra_grader_run(unsigned action, const char* data, unsigned length) noexcept {
    try {
        if (!data || length > (1U << 20) || action < 1 || action > 3) {
            result = R"({"error":"Invalid native grading request."})";
        } else {
            constexpr const char* operations[] = {"assess", "scaffold", "backend-readings"};
            result = noether::grader::grade_json(operations[action - 1], std::string_view(data, length));
        }
    } catch (...) {
        // Avoid exposing raw submitted proof or backend JSON in a diagnostic.
        result = R"({"error":"Native grading request was invalid."})";
    }
    return result.data();
}
extern "C" unsigned veyra_grader_output_length() noexcept { return static_cast<unsigned>(result.size()); }
extern "C" void veyra_grader_clear() noexcept {
    std::fill(result.begin(), result.end(), '\0');
    result.clear();
}
