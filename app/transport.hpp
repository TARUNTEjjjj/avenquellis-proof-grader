#pragma once
#include <string>
#include <string_view>

// POST to the explicitly configured NOETHER_GRADER_URL. No redirects or retries.
std::string request_reviews(std::string_view request);
