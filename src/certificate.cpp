#include <noether/grader/grader.hpp>

#include <algorithm>
#include <array>
#include <charconv>
#include <cstdint>
#include <map>
#include <sstream>
#include <utility>

namespace noether::grader {
namespace {
constexpr std::string_view header = "NOETHER-PROOF/1";
constexpr std::string_view conclusion = "same-positive-divisors -> equal-maxima";
enum class Family { consecutive, gcd };

std::string_view trim(std::string_view value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    return first == value.npos ? std::string_view{} : value.substr(first, value.find_last_not_of(" \t\r\n") - first + 1);
}

std::optional<Family> identify(const Question& question) {
    if (!question.generated || question.max_marks != 10) return {};
    const auto& meta = *question.generated;
    if (meta.type != "proof" || meta.topic != "number-theory" || meta.source_kind != "original" ||
        meta.generator_kind != "deterministic-template" || meta.version != "0.1.0" ||
        !question.id.starts_with(meta.family + "-")) return {};
    const auto suffix = std::string_view(question.id).substr(meta.family.size() + 1);
    if (suffix.empty() || suffix.size() > 7 || suffix.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789") != suffix.npos) return {};
    std::string statement;
    std::vector<Criterion> rubric;
    Family family;
    const auto k = std::to_string(meta.k);
    if (meta.family == "number-consecutive" && meta.k >= 1 && meta.k <= 12 &&
        meta.title == "Three consecutive factors" && meta.difficulty == "foundation") {
        family = Family::consecutive;
        statement = "Prove that (n + " + k + ")(n + " + std::to_string(meta.k + 1) + ")(n + " +
                    std::to_string(meta.k + 2) + ") is divisible by 6 for every integer n.";
        rubric = {{"step-1", "Explain why a factor is divisible by 3.", 4},
                  {"step-2", "Explain why a factor is even.", 4},
                  {"step-3", "Use coprimality to conclude divisibility by 6 for every integer.", 2}};
    } else if (meta.family == "number-gcd" && meta.k >= 7 && meta.k <= 30 &&
               meta.title == "An invariant greatest common divisor" && meta.difficulty == "advanced") {
        family = Family::gcd;
        statement = "Prove that gcd(n, n + " + k + ") = gcd(n, " + k + ") for every positive integer n.";
        rubric = {{"step-1", "Prove every common divisor of n and n+k divides k.", 4},
                  {"step-2", "Prove the converse inclusion of common divisors.", 4},
                  {"step-3", "Conclude equality of the greatest positive common divisors.", 2}};
    } else return {};
    return question.statement == statement && question.rubric == rubric ? std::optional{family} : std::nullopt;
}

using Fields = std::map<std::string, std::string>;
std::optional<Fields> parse_fields(std::string_view answer, const TemplateMetadata& meta, Family family) {
    if (answer.size() > 2048) return {};
    Fields fields;
    std::istringstream input{std::string(answer)};
    std::string line;
    std::getline(input, line); // Header checked before dispatch.
    while (std::getline(input, line)) {
        if (line.ends_with('\r')) {
            if (input.eof() && !trim(line).empty()) return {}; // Only CRLF is a line ending.
            line.pop_back();
        }
        if (trim(line).empty()) continue;
        const auto colon = line.find(':');
        if (colon == line.npos) return {};
        const auto key = line.substr(0, colon);
        const bool common = key == "k" || key == "family";
        const bool specific = family == Family::gcd ? (key == "forward" || key == "reverse" || key == "conclusion")
                                                     : (key == "mod3" || key == "mod2" || key == "bezout");
        if (!common && !specific) return {};
        const auto value = std::string_view(line).substr(colon + 1);
        if (std::any_of(value.begin(), value.end(), [](unsigned char c) { return (c < 32 && c != '\t') || c == 127; })) return {};
        if (!fields.emplace(key, trim(value)).second) return {};
    }
    if (fields["family"] != meta.family || fields["k"] != std::to_string(meta.k)) return {};
    return fields;
}

template <std::size_t N>
std::optional<std::array<std::int64_t, N>> integers(std::string_view text) {
    std::array<std::int64_t, N> result{};
    text = trim(text);
    for (auto& number : result) {
        const auto boundary = text.find_first_of(" \t");
        auto token = text.substr(0, boundary);
        if (token.empty()) return {};
        const bool negative = token.front() == '-';
        if (negative || token.front() == '+') token.remove_prefix(1);
        if (token.empty() || token.size() > 7 || token.find_first_not_of("0123456789") != token.npos) return {};
        const auto parsed = std::from_chars(token.data(), token.data() + token.size(), number);
        if (parsed.ec != std::errc{} || number > 1000000) return {};
        if (negative) number = -number;
        text = boundary == text.npos ? std::string_view{} : trim(text.substr(boundary));
    }
    return text.empty() ? std::optional{result} : std::nullopt;
}

template <std::size_t Modulus>
bool residues(std::string_view value, int k) {
    const auto offsets = integers<Modulus>(value);
    if (!offsets) return false;
    for (std::size_t residue = 0; residue < Modulus; ++residue) {
        const auto offset = (*offsets)[residue];
        if (offset < 0 || offset > 2 || (static_cast<std::int64_t>(residue) + k + offset) % static_cast<int>(Modulus) != 0) return false;
    }
    return true;
}
}

std::optional<std::string> scaffold(const Question& question) {
    validate(question);
    const auto family = identify(question);
    if (!family) return {};
    const auto& meta = *question.generated;
    return std::string(header) + "\nfamily: " + meta.family + "\nk: " + std::to_string(meta.k) +
           (*family == Family::gcd ? "\nforward: _ _\nreverse: _ _\nconclusion: _"
                                   : "\nmod3: _ _ _\nmod2: _ _\nbezout: _ _");
}

namespace detail {
std::optional<Assessment> verify(const Question& question, std::string_view answer) {
    const auto family = identify(question);
    if (!family || !(answer == header || answer.starts_with("NOETHER-PROOF/1\n") || answer.starts_with("NOETHER-PROOF/1\r\n"))) return {};
    auto fields = parse_fields(answer, *question.generated, *family);
    const int k = question.generated->k;
    std::array<bool, 3> steps{};
    std::array<std::string, 3> comments{};
    if (!fields) {
        comments.fill("Certificate field layout, size, question identity, or supplied parameter is invalid.");
    } else if (*family == Family::consecutive) {
        steps[0] = residues<3>((*fields)["mod3"], k);
        steps[1] = residues<2>((*fields)["mod2"], k);
        const auto pair = integers<2>((*fields)["bezout"]);
        steps[2] = steps[0] && steps[1] && pair && 2 * (*pair)[0] + 3 * (*pair)[1] == 1;
        comments = {"Each residue of n modulo 3 must select an actual factor divisible by 3.",
                    "Each residue of n modulo 2 must select an actual even factor.",
                    "Both tables and the identity 2u+3v=1 imply that six divides the product."};
    } else {
        const auto first = integers<2>((*fields)["forward"]);
        const auto second = integers<2>((*fields)["reverse"]);
        // Equality of coefficients verifies these identities for every n, not a sampled n.
        steps[0] = first && (*first)[0] + (*first)[1] == 0 && (*first)[1] * k == k;
        steps[1] = second && (*second)[0] == 1 && (*second)[1] * k == k;
        steps[2] = steps[0] && steps[1] && (*fields)["conclusion"] == conclusion;
        comments = {"k must be the claimed integer combination of n and n+k for every n.",
                    "n+k must be the claimed integer combination of n and k for every n.",
                    "Both inclusions and the equal-maxima rule are required."};
    }
    Assessment result;
    result.lower_bound = 0;
    for (std::size_t i = 0; i < steps.size(); ++i) {
        const int points = steps[i] ? question.rubric[i].points : 0;
        *result.lower_bound += points;
        result.criteria.push_back({question.rubric[i], points, comments[i]});
    }
    const bool complete = std::all_of(steps.begin(), steps.end(), [](bool established) { return established; });
    result.status = complete ? Status::verified_certificate : Status::incomplete_certificate;
    if (complete) result.score = result.lower_bound;
    return result;
}
}
} // namespace noether::grader
