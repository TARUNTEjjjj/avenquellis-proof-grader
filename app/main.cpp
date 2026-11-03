#include "transport.hpp"
#include <noether/grader/grader.hpp>
#include <nlohmann/json.hpp>

#include <fstream>
#include <iostream>
#include <limits>
#include <set>

namespace {
using Json = nlohmann::json;
using namespace noether::grader;

const char* help =
    "Usage: noether-grader <assess|scaffold|finalize|compare|review> [request.json|-]\n"
    "Reads one JSON object from a file or stdin and prints JSON.\n"
    "assess     Check a recognized certificate or prepare a free-form proof for review.\n"
    "scaffold   Print a blank certificate for a supported generated question.\n"
    "finalize   Record explicit human rubric marks, reviewer and rationale.\n"
    "compare    Validate and compare two already obtained readings (no network).\n"
    "review     Request two model readings from NOETHER_GRADER_URL /evaluate.\n"
    "           Use NOETHER_GRADER_TOKEN for remote HTTPS or protected local service.\n";

Json parse(std::string_view text) {
    std::vector<std::set<std::string>> keys;
    return Json::parse(text, [&](int depth, Json::parse_event_t event, Json& parsed) {
        if (depth > 64) throw std::invalid_argument("JSON nesting exceeds 64.");
        if (event == Json::parse_event_t::object_start) keys.emplace_back();
        if (event == Json::parse_event_t::key && !keys.back().insert(parsed.get<std::string>()).second) {
            throw std::invalid_argument("Duplicate JSON key.");
        }
        if (event == Json::parse_event_t::object_end) keys.pop_back();
        return true;
    });
}

int integer(const Json& value) {
    if (value.is_number_unsigned()) {
        auto n = value.get<std::uint64_t>();
        if (n <= static_cast<std::uint64_t>(std::numeric_limits<int>::max())) return static_cast<int>(n);
    } else if (value.is_number_integer()) {
        auto n = value.get<std::int64_t>();
        if (n >= std::numeric_limits<int>::min() && n <= std::numeric_limits<int>::max()) return static_cast<int>(n);
    }
    throw std::invalid_argument("Expected an in-range native integer.");
}

std::string metadata_text(const Json& object, const char* key) {
    const auto it = object.find(key);
    return it != object.end() && it->is_string() ? it->get<std::string>() : std::string{};
}

Question question_from(const Json& data) {
    Question question;
    question.id = data.at("id").get<std::string>();
    question.statement = data.value("statement", std::string{});
    question.max_marks = integer(data.at("maxMarks"));
    const auto& rubric = data.at("rubric");
    if (!rubric.is_array()) throw std::invalid_argument("Rubric must be an array.");
    bool simple = true;
    for (const auto& row : rubric) {
        question.rubric.push_back({row.at("id"), row.at("description"), integer(row.at("points"))});
        simple = simple && row.size() == 3;
    }
    // Unknown rubric or parameter obligations can still be reviewed, but never certified.
    if (simple && data.contains("parameters") && data["parameters"].is_object() &&
        data["parameters"].size() == 1 && data["parameters"].contains("k") && data["parameters"]["k"].is_number_integer() &&
        data.contains("source") && data["source"].is_object() && data.contains("generator") && data["generator"].is_object()) {
        const auto k = data["parameters"]["k"];
        if (k >= 1 && k <= 30) {
            question.generated = TemplateMetadata{metadata_text(data, "templateId"), metadata_text(data, "title"), metadata_text(data, "type"),
                metadata_text(data, "topic"), metadata_text(data, "difficulty"), metadata_text(data["source"], "kind"),
                metadata_text(data["generator"], "kind"), metadata_text(data["generator"], "version"), integer(k)};
        }
    }
    validate(question);
    return question;
}

Scores points_from(const Json& values) {
    if (!values.is_object()) throw std::invalid_argument("criterionScores must be an object.");
    Scores scores;
    for (const auto& [id, mark] : values.items()) scores.emplace(id, integer(mark));
    return scores;
}

Reading reading_from(const Json& row) {
    Reading reading{points_from(row.at("criterionScores")), row.at("rationale"), {}};
    const auto& cites = row.at("evidence");
    if (!cites.is_array()) throw std::invalid_argument("Evidence must be an array.");
    for (const auto& cite : cites) reading.evidence.push_back({cite.at("criterionId"), cite.at("quote")});
    return reading;
}

Json assessment_json(const Question& question, const Assessment& result) {
    Json rows = Json::array();
    for (const auto& row : result.criteria) {
        rows.push_back({{"id", row.criterion.id}, {"description", row.criterion.description}, {"maxPoints", row.criterion.points},
                        {"points", row.points}, {"feedback", row.feedback}});
        if (result.lower_bound) rows.back()["verified"] = row.points.value_or(0) > 0;
    }
    Json output = {{"questionId", question.id}, {"status", name(result.status)}, {"score", result.score},
                   {"maxMarks", question.max_marks}, {"criteria", rows}};
    if (result.lower_bound) {
        output["lowerBoundPoints"] = *result.lower_bound;
        output["complete"] = result.status == Status::verified_certificate;
    }
    if (result.status == Status::human_reviewed) {
        output["reviewer"] = result.reviewer;
        output["rationale"] = result.rationale;
        output["reviewerIdentityVerified"] = false;
    }
    return output;
}

Json compare_json(const Question& question, std::string_view answer, const Json& reviews, bool from_endpoint) {
    if (!reviews.is_array() || reviews.size() != 2) throw std::invalid_argument("Exactly two reader slots are required.");
    std::array<std::optional<Reading>, 2> readings;
    std::array<std::string, 2> errors;
    for (std::size_t i = 0; i < readings.size(); ++i) {
        const auto& row = reviews[i];
        if (row.is_null()) continue;
        try {
            if (from_endpoint && (integer(row.at("reviewer")) != static_cast<int>(i + 1) || row.at("status") != "proposal")) {
                errors[i] = "The backend did not return a proposal for this reader.";
            } else readings[i] = reading_from(row);
        } catch (const std::exception&) { errors[i] = "Invalid reader payload."; }
    }
    const auto result = compare(question, answer, readings);
    Json safe_reviews = Json::array();
    for (std::size_t i = 0; i < readings.size(); ++i) {
        Json item = {{"reviewer", i + 1}, {"score", result.reader_scores[i]}};
        if (result.reader_scores[i]) {
            item["criterionScores"] = readings[i]->points;
            item["rationale"] = readings[i]->rationale;
            item["evidence"] = Json::array();
            for (const auto& cite : readings[i]->evidence) {
                item["evidence"].push_back({{"criterionId", cite.criterion_id}, {"quote", cite.quote}});
            }
            if (reviews[i].contains("gaps") && reviews[i]["gaps"].is_array()) {
                item["gaps"] = Json::array();
                for (const auto& gap : reviews[i]["gaps"]) if (gap.is_string()) item["gaps"].push_back(gap);
            }
        } else item["error"] = errors[i].empty() ? result.reader_errors[i] : errors[i];
        safe_reviews.push_back(item);
    }
    return {{"questionId", question.id}, {"status", result.suggested_score ? "awaiting_review" : "needs_review"},
            {"score", nullptr}, {"suggestedScore", result.suggested_score}, {"maxMarks", question.max_marks},
            {"reviews", safe_reviews}, {"disagreements", result.disagreements},
            {"mode", from_endpoint ? "backend_review" : "supplied_readings"},
            {"notice", "Matching proposals and cited evidence do not establish mathematical correctness. Human review is required."}};
}

Json run(std::string_view action, const Json& request) {
    const auto& original = request.at("question");
    const auto question = question_from(original);
    if (action == "scaffold") return {{"questionId", question.id}, {"scaffold", scaffold(question)}};
    const auto answer = request.at("answer").get<std::string>();
    if (action == "assess") return assessment_json(question, assess(question, answer));
    if (action == "finalize") return assessment_json(question, finalize(question, answer, points_from(request.at("criterionScores")),
                                                   request.at("reviewer").get<std::string>(), request.at("rationale").get<std::string>()));
    if (action == "compare") return compare_json(question, answer, request.at("reviews"), false);
    if (action == "review") {
        const auto preliminary = assess(question, answer);
        if (preliminary.status != Status::needs_review) return assessment_json(question, preliminary);
        Json grading_question = {{"id", question.id}, {"statement", question.statement}, {"maxMarks", question.max_marks}, {"rubric", Json::array()}};
        for (const auto& row : question.rubric) {
            grading_question["rubric"].push_back({{"id", row.id}, {"description", row.description}, {"points", row.points}});
        }
        if (original.contains("solution") && original["solution"].is_string()) grading_question["solution"] = original["solution"];
        const Json payload = {{"question", std::move(grading_question)}, {"answer", answer}};
        const auto reply = parse(request_reviews(payload.dump()));
        if (reply.at("questionId") != question.id || reply.at("answer") != answer) {
            throw std::invalid_argument("Backend response does not match this question and submission.");
        }
        return compare_json(question, answer, reply.at("reviews"), true);
    }
    throw std::invalid_argument("Unknown action; use --help.");
}
}

int main(int argc, char** argv) {
    if (argc == 2 && std::string_view(argv[1]) == "--help") { std::cout << help; return 0; }
    if (argc < 2 || argc > 3) { std::cerr << help; return 2; }
    try {
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
        std::cout << run(argv[1], parse(text)).dump() << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << Json{{"error", error.what()}}.dump(-1, ' ', false, Json::error_handler_t::replace) << '\n';
        return 2;
    }
}
