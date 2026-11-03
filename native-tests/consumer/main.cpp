#include <avenquellis/grader/grader.hpp>

int main() {
    namespace grade = avenquellis::grader;
    grade::Question question{"local", "Prove the claim.", 2, {{"argument", "A complete proof", 2}}, std::nullopt};
    auto result = grade::assess(question, "An argument waiting for a human reader.");
    return result.status == grade::Status::needs_review && !result.score ? 0 : 1;
}
