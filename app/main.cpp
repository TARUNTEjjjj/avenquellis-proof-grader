#include "transport.hpp"
#include "json_api.hpp"
#include <nlohmann/json.hpp>

#include <fstream>
#include <iostream>
#include <set>
#include <string>
#include <vector>

namespace {
using Json = nlohmann::json;
using namespace noether::grader;

const char* help =
    "Usage: avenquellis-grader <assess|scaffold|finalize|compare|review|diagnose> [request.json|-] [--pretty]\n"
    "Reads one JSON object from a file or stdin and prints JSON.\n"
    "assess     Check a recognized certificate or prepare a free-form proof for review.\n"
    "scaffold   Print a blank certificate for a supported generated question.\n"
    "finalize   Record explicit human rubric marks, reviewer and rationale.\n"
    "compare    Validate and compare two already obtained readings (no network).\n"
    "review     Request two model readings from AVENQUELLIS_GRADER_URL /evaluate.\n"
    "           Use AVENQUELLIS_GRADER_TOKEN for remote HTTPS or protected local service.\n"
    "diagnose   Run certificate assessment + dependency-DAG soundness gap analysis (+ compare if reviews supplied).\n";

// Redirected output is buffered, so a write error may only appear when it is flushed.
void write_stdout(std::string_view text) {
    std::cout << text << std::flush;
    if (!std::cout) throw std::runtime_error("Could not write to stdout.");
}

std::string build_diagnostic(std::string_view request_text) {
    const Json req = Json::parse(request_text);
    const Json assessed = Json::parse(noether::grader::grade_json("assess", request_text, request_reviews));
    const std::string status = assessed.at("status").get<std::string>();
    const int max_marks = assessed.at("maxMarks").get<int>();
    const int lower_bound = assessed.contains("lowerBoundPoints") ? assessed.at("lowerBoundPoints").get<int>() : 0;

    Json chain = Json::array();
    Json gaps = Json::array();
    int verified_criteria = 0;
    const auto& criteria = assessed.at("criteria");
    for (std::size_t i = 0; i < criteria.size(); ++i) {
        const auto& row = criteria[i];
        const int pts = (!row["points"].is_null()) ? row["points"].get<int>() : 0;
        const int max_pts = row.at("maxPoints").get<int>();
        const bool verified = pts > 0 && status != "needs_review";
        if (verified) ++verified_criteria;
        const std::string step_status = (status == "needs_review") ? "unverified_free_form"
                                      : (verified ? "verified" : "missing_or_unsound");
        Json deps = Json::array();
        if (i > 0) deps.push_back(criteria[i - 1].at("id"));
        chain.push_back({
            {"criterionId", row.at("id")},
            {"maxPoints", max_pts},
            {"awardedPoints", row["points"]},
            {"status", step_status},
            {"dependencies", deps},
            {"diagnostic", row.at("feedback")},
        });
        if (!verified) {
            gaps.push_back({
                {"criterionId", row.at("id")},
                {"pointsAtRisk", max_pts - pts},
                {"reason", row.at("feedback")},
            });
        }
    }

    Json diag = {
        {"questionId", assessed.at("questionId")},
        {"diagnosticMode", "certificate-and-rubric-dag"},
        {"status", status},
        {"certificateRecognized", status != "needs_review"},
        {"score", assessed["score"]},
        {"lowerBoundPoints", lower_bound},
        {"maxMarks", max_marks},
        {"verifiedRatio", max_marks > 0 ? static_cast<double>(lower_bound) / static_cast<double>(max_marks) : 0.0},
        {"verifiedCriteriaCount", verified_criteria},
        {"totalCriteriaCount", static_cast<int>(criteria.size())},
        {"dependencyChain", chain},
        {"soundnessGaps", gaps},
    };
    if (assessed.contains("feedback")) diag["certificateFeedback"] = assessed["feedback"];
    if (req.contains("reviews") && req["reviews"].is_array() && req["reviews"].size() == 2) {
        const Json cmp = Json::parse(noether::grader::grade_json("compare", request_text, request_reviews));
        diag["consensus"] = {
            {"suggestedScore", cmp["suggestedScore"]},
            {"disagreements", cmp.at("disagreements")},
            {"reviews", cmp.at("reviews")},
        };
    }
    return diag.dump();
}

}

int main(int argc, char** argv) {
    bool pretty = false;
    std::vector<std::string_view> args;
    for (int i = 1; i < argc; ++i) {
        const std::string_view tok(argv[i]);
        if (tok == "--pretty") pretty = true;
        else args.push_back(tok);
    }
    if (args.empty() || args.size() > 2) { std::cerr << help; return 2; }
    try {
        if (args.size() == 1 && args[0] == "--help") { write_stdout(help); return 0; }
        std::ifstream file;
        std::istream* input = &std::cin;
        if (args.size() == 2 && args[1] != "-") {
            file.open(std::string(args[1]), std::ios::binary);
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
        const std::string out = (args[0] == "diagnose")
            ? build_diagnostic(text)
            : noether::grader::grade_json(args[0], text, request_reviews);
        if (pretty) {
            write_stdout(Json::parse(out).dump(2) + '\n');
        } else {
            write_stdout(out + '\n');
        }
        return 0;
    } catch (const Json::exception&) {
        std::cerr << "{\"error\":\"A required JSON field is missing or has the wrong type.\"}\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << Json{{"error", error.what()}}.dump(-1, ' ', false, Json::error_handler_t::replace) << '\n';
        return 2;
    }
}
