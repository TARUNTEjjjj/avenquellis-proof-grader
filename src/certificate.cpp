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
constexpr std::string_view header = "AVENQUELLIS-PROOF/1";
constexpr std::string_view conclusion = "same-positive-divisors -> equal-maxima";
enum class Family { consecutive, gcd };

// ECMAScript String.trim includes Unicode space separators at field boundaries.
// Inside a coefficient sequence only ASCII space and tab delimit the integers.
std::string_view trim(std::string_view value) {
    static constexpr std::string_view spaces[] = {
        " ", "\t", "\n", "\v", "\f", "\r", "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004",
        "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"
    };
    while (!value.empty()) {
        const auto match = std::find_if(std::begin(spaces), std::end(spaces), [&](auto space) { return value.starts_with(space); });
        if (match == std::end(spaces)) break;
        value.remove_prefix(match->size());
    }
    while (!value.empty()) {
        const auto match = std::find_if(std::begin(spaces), std::end(spaces), [&](auto space) { return value.ends_with(space); });
        if (match == std::end(spaces)) break;
        value.remove_suffix(match->size());
    }
    return value;
}

// Matches the question engine's UTF-8 decoding and JavaScript for-of + charCodeAt(0)
// hashing. For a supplementary scalar only its first UTF-16 unit is hashed.
std::optional<std::uint32_t> seed_hash(std::string_view seed) {
    if (seed.empty() || seed.size() > 1024) return {};
    std::uint32_t hash = 2166136261u;
    unsigned units = 0;
    for (std::size_t pos = 0; pos < seed.size();) {
        const unsigned first = static_cast<unsigned char>(seed[pos++]);
        std::uint32_t cp = first;
        unsigned extra = 0;
        if (first >= 0x80) {
            if (first >= 0xc2 && first <= 0xdf) { cp = first & 31u; extra = 1; }
            else if (first >= 0xe0 && first <= 0xef) { cp = first & 15u; extra = 2; }
            else if (first >= 0xf0 && first <= 0xf4) { cp = first & 7u; extra = 3; }
            else return {};
            if (seed.size() - pos < extra) return {};
            for (unsigned j = 0; j < extra; ++j) {
                const unsigned byte = static_cast<unsigned char>(seed[pos++]);
                if ((byte & 0xc0u) != 0x80u) return {};
                cp = (cp << 6u) | (byte & 63u);
            }
            if ((extra == 2 && cp < 0x800) || (extra == 3 && cp < 0x10000) ||
                (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return {};
        }
        units += cp > 0xffff ? 2u : 1u;
        if (units > 256) return {};
        const auto unit = cp > 0xffff ? 0xd800u + ((cp - 0x10000u) >> 10u) : cp;
        hash = (hash ^ unit) * 16777619u;
    }
    return hash;
}

bool replay_instance(const Question& question, Family family) {
    const auto& meta = *question.generated;
    const auto hash = seed_hash(meta.seed);
    if (!hash) return false;
    std::array<char, 7> suffix{};
    const auto conversion = std::to_chars(suffix.data(), suffix.data() + suffix.size(), *hash, 36);
    if (conversion.ec != std::errc{} || question.id != meta.family + "-" + std::string(suffix.data(), conversion.ptr)) return false;
    const bool consecutive = family == Family::consecutive;
    const std::string_view bank = consecutive ? "number-consecutive-1821pae" : "number-gcd-17s23lf";
    if (question.id == bank) {
        if (meta.seed != (consecutive ? "bank:5" : "bank:6") ||
            meta.exam != "CMI" || meta.requested_difficulty != meta.difficulty) return false;
    } else {
        if (meta.exam != "CMI" && meta.exam != "ISI" && meta.exam != "RMO") return false;
        if (meta.requested_difficulty != "foundation" && meta.requested_difficulty != "advanced" && meta.requested_difficulty != "olympiad") return false;
        if (!meta.seed.ends_with(":variant")) {
            const auto pos = meta.seed.rfind(":mock:");
            if (pos == std::string::npos) return false;
            const auto attempt = std::string_view(meta.seed).substr(pos + 6);
            unsigned index{};
            if (attempt.empty() || attempt.size() > 4 || (attempt.size() > 1 && attempt.front() == '0')) return false;
            const auto read = std::from_chars(attempt.data(), attempt.data() + attempt.size(), index);
            if (read.ec != std::errc{} || read.ptr != attempt.data() + attempt.size() || index >= 4096) return false;
        }
    }
    const std::uint32_t state = *hash + 0x6d2b79f5u;
    auto mixed = (state ^ (state >> 15u)) * (1u | state);
    mixed ^= mixed + (mixed ^ (mixed >> 7u)) * (61u | mixed);
    const auto draw = mixed ^ (mixed >> 14u);
    const auto width = consecutive ? 12u : 24u;
    const int k = (consecutive ? 1 : 7) + static_cast<int>((static_cast<std::uint64_t>(draw) * width) >> 32u);
    return meta.k == k;
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
    return question.statement == statement && question.rubric == rubric && replay_instance(question, family) ? std::optional{family} : std::nullopt;
}

using Fields = std::map<std::string, std::string>;
std::optional<Fields> parse_fields(std::string_view answer, const TemplateMetadata& meta, Family family) {
    if (answer.size() > 8192) return {};
    std::size_t units = 0;
    for (const char c : answer) {
        const auto byte = static_cast<unsigned char>(c);
        if ((byte & 0xc0u) != 0x80u) units += byte >= 0xf0 ? 2u : 1u;
    }
    if (units > 2048) return {};
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
        if (boundary == text.npos) text = {};
        else {
            const auto next = text.find_first_not_of(" \t", boundary);
            text = next == text.npos ? std::string_view{} : text.substr(next);
        }
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
// The grader's required text fields share the ECMAScript whitespace rule.
bool blank(std::string_view value) { return trim(value).empty(); }

std::optional<Assessment> verify(const Question& question, std::string_view answer) {
    const auto family = identify(question);
    const auto first_line = answer.substr(0, answer.find('\n'));
    auto identifier = first_line;
    if (first_line.size() < answer.size() && identifier.ends_with('\r')) identifier.remove_suffix(1);
    const bool recognized = identifier == header || identifier == "NOETHER-PROOF/1" || identifier == "VEYRA-PROOF/1";
    if (!family || !recognized) return {};
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
