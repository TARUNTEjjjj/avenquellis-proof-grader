#include "transport.hpp"
#include "json_api.hpp"
#include <nlohmann/json.hpp>

#include <fstream>
#include <iostream>

namespace {
using Json = nlohmann::json;
using namespace noether::grader;

const char* help =
    "Usage: avenquellis-grader <assess|scaffold|finalize|compare|review> [request.json|-]\n"
    "Reads one JSON object from a file or stdin and prints JSON.\n"
    "assess     Check a recognized certificate or prepare a free-form proof for review.\n"
    "scaffold   Print a blank certificate for a supported generated question.\n"
    "finalize   Record explicit human rubric marks, reviewer and rationale.\n"
    "compare    Validate and compare two already obtained readings (no network).\n"
    "review     Request two model readings from AVENQUELLIS_GRADER_URL /evaluate.\n"
    "           Use AVENQUELLIS_GRADER_TOKEN for remote HTTPS or protected local service.\n";

// Redirected output is buffered, so a write error may only appear when it is flushed.
void write_stdout(std::string_view text) {
    std::cout << text << std::flush;
    if (!std::cout) throw std::runtime_error("Could not write to stdout.");
}

}

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3) { std::cerr << help; return 2; }
    try {
        if (argc == 2 && std::string_view(argv[1]) == "--help") { write_stdout(help); return 0; }
        std::ifstream file;
        std::istream* input = &std::cin;
        if (argc == 3 && std::string_view(argv[2]) != "-") {
            file.open(argv[2], std::ios::binary);
            if (!file) throw std::invalid_argument("Cannot open request file.");
            input = &file;
        }
        std::string text;
        char buffer[8192];
        while (input->read(buffer, sizeof buffer) || input->gcount()) {
            if (text.size() + static_cast<std::size_t>(input->gcount()) > (1U << 20)) throw std::invalid_argument("Request exceeds 1 MiB.");
            text.append(buffer, static_cast<std::size_t>(input->gcount()));
        }
        if (input->bad()) throw std::runtime_error("Request read failed.");
        write_stdout(noether::grader::grade_json(argv[1], text, request_reviews) + '\n');
        return 0;
    } catch (const Json::exception&) {
        std::cerr << "{\"error\":\"A required JSON field is missing or has the wrong type.\"}\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << Json{{"error", error.what()}}.dump(-1, ' ', false, Json::error_handler_t::replace) << '\n';
        return 2;
    }
}
