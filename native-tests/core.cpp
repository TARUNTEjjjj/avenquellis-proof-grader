#include <noether/grader/grader.hpp>

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
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
