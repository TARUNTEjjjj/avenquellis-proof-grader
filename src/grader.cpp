#include <noether/grader/grader.hpp>

#include <set>
#include <stdexcept>

namespace noether::grader {
namespace detail {
std::optional<Assessment> verify(const Question&, std::string_view);
bool blank(std::string_view);
}
namespace {
// Text is blank when ECMAScript trim() would empty it, as in the JavaScript validators.
bool blank(std::string_view value) { return detail::blank(value); }

void validate_answer(std::string_view answer) {
    if (answer.size() > 200000) throw std::invalid_argument("Answer exceeds 200,000 UTF-8 bytes.");
}

int total(const Question& question, const Scores& scores) {
    if (scores.size() != question.rubric.size()) throw std::invalid_argument("Supply a mark for each criterion.");
    int sum = 0;
    for (const auto& item : question.rubric) {
        const auto it = scores.find(item.id);
        if (it == scores.end() || it->second < 0 || it->second > item.points) {
            throw std::invalid_argument("Missing or out-of-range score for " + item.id);
        }
        sum += it->second; // Validated rubric total fits int.
    }
    return sum;
}

int validate_reading(const Question& question, std::string_view answer, const Reading& reading) {
    const int sum = total(question, reading.points);
    if (blank(reading.rationale)) throw std::invalid_argument("A mathematical rationale is required.");
    std::set<std::string> supported;
    for (const auto& cite : reading.evidence) {
        if (!reading.points.contains(cite.criterion_id) || blank(cite.quote) ||
            answer.find(cite.quote) == std::string_view::npos) {
            throw std::invalid_argument("An evidence quotation or its criterion does not match.");
        }
        supported.insert(cite.criterion_id);
    }
    for (const auto& [id, points] : reading.points) {
        if (points > 0 && !supported.contains(id)) throw std::invalid_argument("Missing positive-award evidence for " + id);
    }
    return sum;
}
}

std::string_view name(Status status) noexcept {
    switch (status) {
        case Status::needs_review: return "needs_review";
        case Status::incomplete_certificate: return "incomplete_certificate";
        case Status::verified_certificate: return "verified_certificate";
        case Status::human_reviewed: return "human_reviewed";
    }
    return "unknown";
}

void validate(const Question& question) {
    if (blank(question.id) || question.max_marks <= 0 || question.rubric.empty()) {
        throw std::invalid_argument("A question ID, positive maximum and nonempty rubric are required.");
    }
    std::set<std::string> ids;
    int sum = 0;
    for (const auto& criterion : question.rubric) {
        if (blank(criterion.id) || !ids.insert(criterion.id).second || blank(criterion.description) || criterion.points <= 0) {
            throw std::invalid_argument("Invalid or duplicate rubric criterion.");
        }
        if (criterion.points > question.max_marks - sum) throw std::invalid_argument("Rubric exceeds question maximum.");
        sum += criterion.points;
    }
    if (sum != question.max_marks) throw std::invalid_argument("Rubric points must sum to maxMarks.");
}

Assessment assess(const Question& question, std::string_view answer) {
    validate(question);
    validate_answer(answer);
    if (auto checked = detail::verify(question, answer)) return *checked;
    Assessment result;
    for (const auto& item : question.rubric) {
        result.criteria.push_back({item, std::nullopt, "A reviewer must evaluate this deduction in the full proof."});
    }
    return result;
}

Assessment finalize(const Question& question, std::string_view answer, const Scores& scores,
                    std::string_view reviewer, std::string_view rationale) {
    validate(question);
    validate_answer(answer);
    // The reviewer limit counts UTF-16 code units, as JavaScript finalizeReview does. A UTF-8 lead byte opens
    // one unit, or two for a four-byte sequence. The byte bound also limits text that is not UTF-8.
    std::size_t units = 0;
    for (const char c : reviewer) {
        const auto byte = static_cast<unsigned char>(c);
        if ((byte & 0xc0u) != 0x80u) units += byte >= 0xf0 ? 2u : 1u;
    }
    if (blank(reviewer) || reviewer.size() > 800 || units > 200 || blank(rationale)) {
        throw std::invalid_argument("A reviewer (at most 200 UTF-16 code units) and mathematical rationale are required.");
    }
    Assessment result;
    result.status = Status::human_reviewed;
    result.score = total(question, scores);
    result.reviewer = reviewer;
    result.rationale = rationale;
    for (const auto& item : question.rubric) result.criteria.push_back({item, scores.at(item.id), {}});
    return result;
}

Consensus compare(const Question& question, std::string_view answer,
                  const std::array<std::optional<Reading>, 2>& readings) {
    validate(question);
    validate_answer(answer);
    Consensus result;
    for (std::size_t i = 0; i < readings.size(); ++i) {
        if (!readings[i]) {
            result.reader_errors[i] = "No reading supplied.";
            continue;
        }
        try {
            result.reader_scores[i] = validate_reading(question, answer, *readings[i]);
        } catch (const std::invalid_argument& error) {
            result.reader_errors[i] = error.what();
        }
    }
    if (!result.reader_scores[0] || !result.reader_scores[1]) return result;
    for (const auto& criterion : question.rubric) {
        if (readings[0]->points.at(criterion.id) != readings[1]->points.at(criterion.id)) {
            result.disagreements.push_back(criterion.id);
        }
    }
    if (result.disagreements.empty()) result.suggested_score = result.reader_scores[0];
    return result;
}
} // namespace noether::grader
