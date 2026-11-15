#pragma once
#include <string>
#include <string_view>

// POST to the explicitly configured AVENQUELLIS_GRADER_URL (or legacy NOETHER_GRADER_URL). No redirects or retries.
// The bearer token comes from the same pair of names as the URL: AVENQUELLIS_GRADER_TOKEN with
// AVENQUELLIS_GRADER_URL, and the legacy NOETHER_GRADER_TOKEN only with the legacy URL.
std::string request_reviews(std::string_view request);
