#pragma once

#include <array>
#include <cstddef>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace noether::grader {

struct Criterion {
    std::string id;
    std::string description;
    int points{};
    bool operator==(const Criterion&) const = default;
};

// Import the complete generator reference and exactly one integral parameter k.
// Exam assignments and reviewer identities must come from the hosting application.
struct TemplateMetadata {
    std::string family, title, type, topic, difficulty, source_kind, generator_kind, version;
    int k{};
    std::string seed, exam, requested_difficulty;
};

struct Question {
    std::string id, statement;
    int max_marks{};
    std::vector<Criterion> rubric;
    std::optional<TemplateMetadata> generated;
};

enum class Status { needs_review, incomplete_certificate, verified_certificate, human_reviewed };
[[nodiscard]] std::string_view name(Status status) noexcept;

struct CriterionResult {
    Criterion criterion;
    std::optional<int> points;
    std::string feedback;
};

struct Assessment {
    Status status{Status::needs_review};
    std::optional<int> score;
    // Exists only for a recognized certificate. Unverified deductions carry no final mark.
    std::optional<int> lower_bound;
    std::vector<CriterionResult> criteria;
    std::string reviewer, rationale;
};

using Scores = std::map<std::string, int>;
struct Evidence {
    std::string criterion_id, quote;
};
struct Reading {
    Scores points;
    std::string rationale;
    std::vector<Evidence> evidence;
};
struct Consensus {
    std::optional<int> suggested_score;
    std::array<std::optional<int>, 2> reader_scores;
    std::array<std::string, 2> reader_errors;
    std::vector<std::string> disagreements;
};

void validate(const Question& question);
[[nodiscard]] Assessment assess(const Question& question, std::string_view answer);
[[nodiscard]] std::optional<std::string> scaffold(const Question& question);
// This records an explicitly supplied human decision. The caller authenticates the reviewer.
[[nodiscard]] Assessment finalize(const Question& question, std::string_view answer, const Scores& scores,
                                  std::string_view reviewer, std::string_view rationale);
// No inference occurs here. The caller obtains both readings independently.
[[nodiscard]] Consensus compare(const Question& question, std::string_view answer,
                                const std::array<std::optional<Reading>, 2>& readings);

} // namespace noether::grader
