#pragma once
#include <string>
#include <string_view>

namespace noether::grader {
using ReviewTransport = std::string (*)(std::string_view);
std::string grade_json(std::string_view action, std::string_view input, ReviewTransport transport = nullptr);
}
