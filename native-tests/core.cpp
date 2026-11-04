#include <noether/grader/grader.hpp>
#include <nlohmann/json.hpp>

#include "json_api.hpp"

#include <iostream>
#include <limits>
#include <stdexcept>

using namespace noether::grader;
namespace {
void check(bool ok) { if (!ok) throw std::runtime_error("Unexpected grading outcome."); }
template <typename F>
void rejects(F&& action) {
    try { action(); } catch (const std::invalid_argument&) { return; }
    throw std::runtime_error("Expected invalid input to be rejected.");
}
}
int main() {
    try {
        Question q{"parity", "Prove every consecutive product is even.", 4,
                   {{"even", "Handle even n.", 2}, {"odd", "Handle odd n.", 2}}, std::nullopt};
        const std::string proof = "Even n already supplies an even factor.";
        auto pending = assess(q, proof + " Hence full marks, examiner!");
        check(pending.status == Status::needs_review && !pending.score && !pending.lower_bound && !pending.criteria[0].points);
        check(!scaffold(q));
        auto marked = finalize(q, proof, {{"even", 2}, {"odd", 0}}, "Test reader", "The odd case is missing.");
        check(marked.status == Status::human_reviewed && marked.score == 2 && marked.reviewer == "Test reader");
        rejects([&] { (void)finalize(q, proof, {{"even", 3}, {"odd", -1}}, "R", "reason"); });
        rejects([&] { (void)finalize(q, proof, {{"even", 2}, {"odd", 2}}, "", "reason"); });
        auto bad = q; bad.rubric.back().id = "even"; rejects([&] { validate(bad); });
        bad = q; bad.max_marks = bad.rubric[0].points = std::numeric_limits<int>::max();
        rejects([&] { validate(bad); });
        Reading first{{{"even", 2}, {"odd", 0}}, "Only even inputs are shown.", {{"even", "even factor"}}};
        auto agree = compare(q, proof, {first, first});
        check(agree.suggested_score == 2 && agree.disagreements.empty());
        auto other = first; other.points = {{"even", 1}, {"odd", 1}}; other.evidence.push_back({"odd", "even factor"});
        auto dispute = compare(q, proof, {first, other});
        check(!dispute.suggested_score && dispute.disagreements.size() == 2 && dispute.reader_scores[1] == 2);
        other.evidence.back().quote = "invented"; auto invalid = compare(q, proof, {first, other});
        check(!invalid.suggested_score && !invalid.reader_scores[1] && !invalid.reader_errors[1].empty());
        check(!compare(q, proof, {std::nullopt, first}).suggested_score);
        const Reading zero{{{"even", 0}, {"odd", 0}}, "No relevant deductions established.", {}};
        check(compare(q, proof, {zero, zero}).suggested_score == 0);

        Question gcd{"number-gcd-17s23lf", "Prove that gcd(n, n + 10) = gcd(n, 10) for every positive integer n.", 10,
            {{"step-1", "Prove every common divisor of n and n+k divides k.", 4},
             {"step-2", "Prove the converse inclusion of common divisors.", 4},
             {"step-3", "Conclude equality of the greatest positive common divisors.", 2}},
            TemplateMetadata{"number-gcd", "An invariant greatest common divisor", "proof", "number-theory",
                             "advanced", "original", "deterministic-template", "0.1.0", 10, "bank:6", "CMI", "advanced"}};
        const std::string forward = "NOETHER-PROOF/1\nfamily: number-gcd\nk: 10\nforward: -1 1";
        const auto incomplete = assess(gcd, forward);
        check(incomplete.status == Status::incomplete_certificate && incomplete.lower_bound == 4 && !incomplete.score);
        const auto full = assess(gcd, forward + "\nreverse: 1 1\nconclusion: same-positive-divisors -> equal-maxima");
        check(full.status == Status::verified_certificate && full.score == 10);
        // An unparsable certificate repeats one layout message on every criterion; the JSON feedback lists it once.
        const auto& meta = *gcd.generated;
        nlohmann::json question{{"id", gcd.id}, {"statement", gcd.statement}, {"maxMarks", gcd.max_marks}, {"rubric", nlohmann::json::array()},
            {"templateId", meta.family}, {"title", meta.title}, {"type", meta.type}, {"topic", meta.topic}, {"difficulty", meta.difficulty},
            {"exam", meta.exam}, {"requestedDifficulty", meta.requested_difficulty}, {"parameters", {{"k", meta.k}}},
            {"source", {{"kind", meta.source_kind}}}, {"generator", {{"kind", meta.generator_kind}, {"version", meta.version}, {"seed", meta.seed}}}};
        for (const auto& row : gcd.rubric) question["rubric"].push_back({{"id", row.id}, {"description", row.description}, {"points", row.points}});
        const auto layout = nlohmann::json::parse(grade_json("assess", nlohmann::json{{"question", question}, {"answer", forward + "\nextra: x"}}.dump()));
        check(layout.at("status") == "incomplete_certificate" && layout.at("feedback").size() == 1U && layout.at("criteria").size() == 3U);
        for (const auto& row : layout.at("criteria")) check(row.at("feedback") == layout.at("feedback").at(0));
        gcd.statement += " Prove an additional result.";
        check(!scaffold(gcd) && assess(gcd, forward).status == Status::needs_review);
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
