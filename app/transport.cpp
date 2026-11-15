#include "transport.hpp"
#include <curl/curl.h>

#include <algorithm>
#include <cstdlib>
#include <memory>
#include <stdexcept>

namespace {
using Url = std::unique_ptr<CURLU, decltype(&curl_url_cleanup)>;
using Client = std::unique_ptr<CURL, decltype(&curl_easy_cleanup)>;
using Headers = std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)>;

std::string part(CURLU* url, CURLUPart field) {
    char* raw = nullptr;
    if (curl_url_get(url, field, &raw, 0) != CURLUE_OK) return {};
    std::unique_ptr<char, decltype(&curl_free)> value(raw, curl_free);
    return value.get();
}

std::size_t append(char* data, std::size_t size, std::size_t count, void* context) noexcept {
    constexpr std::size_t limit = 1 << 20;
    auto& output = *static_cast<std::string*>(context);
    if (size != 1 || count > limit - output.size()) return 0;
    try { output.append(data, count); } catch (...) { return 0; }
    return count;
}

void add_header(Headers& headers, const std::string& value) {
    curl_slist* appended = curl_slist_append(headers.get(), value.c_str());
    if (!appended) throw std::bad_alloc{};
    headers.release();
    headers.reset(appended);
}
}

std::string request_reviews(std::string_view request) {
    if (request.size() > 100000) throw std::invalid_argument("Review request exceeds the CLI's 100,000-byte limit.");
    // The endpoint and its bearer token are read as one pair of names. A token is never sent to an endpoint set
    // under the other name: not a stale legacy token to a new endpoint, nor the new token to a stale legacy endpoint.
    const char* endpoint = std::getenv("AVENQUELLIS_GRADER_URL");
    const bool legacy = !endpoint;
    if (legacy) endpoint = std::getenv("NOETHER_GRADER_URL");
    const char* token_env = std::getenv(legacy ? "NOETHER_GRADER_TOKEN" : "AVENQUELLIS_GRADER_TOKEN");
    // A token set only under the other name is never sent. Name the pairing where that can explain a refusal, or a
    // 401 from a protected loopback service would look like a wrong token.
    const char* unsent_token = std::getenv(legacy ? "AVENQUELLIS_GRADER_TOKEN" : "NOETHER_GRADER_TOKEN");
    const char* pairing = legacy
        ? "The legacy NOETHER_GRADER_URL takes only NOETHER_GRADER_TOKEN; "
          "set AVENQUELLIS_GRADER_URL to use AVENQUELLIS_GRADER_TOKEN."
        : "AVENQUELLIS_GRADER_URL takes only AVENQUELLIS_GRADER_TOKEN, not the legacy NOETHER_GRADER_TOKEN.";
    if (!endpoint || !*endpoint) throw std::invalid_argument("Set AVENQUELLIS_GRADER_URL to the Avenquellis /evaluate endpoint.");
    const std::string token = token_env ? token_env : "";
    if (std::any_of(token.begin(), token.end(), [](unsigned char c) { return c < 32 || c == 127; })) {
        throw std::invalid_argument("Invalid bearer-token characters.");
    }
    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) throw std::runtime_error("Could not initialize HTTP client.");
    struct Cleanup { ~Cleanup() { curl_global_cleanup(); } } cleanup;
    Url url(curl_url(), curl_url_cleanup);
    if (!url || curl_url_set(url.get(), CURLUPART_URL, endpoint, CURLU_DISALLOW_USER) != CURLUE_OK) {
        throw std::invalid_argument("Invalid review endpoint URL.");
    }
    const auto host = part(url.get(), CURLUPART_HOST);
    const auto scheme = part(url.get(), CURLUPART_SCHEME);
    const bool loopback = host == "127.0.0.1" || host == "[::1]" || host == "localhost";
    if (host.empty() || !(scheme == "https" || (loopback && scheme == "http")) ||
        !part(url.get(), CURLUPART_QUERY).empty() || !part(url.get(), CURLUPART_FRAGMENT).empty() ||
        part(url.get(), CURLUPART_PATH) != "/evaluate") {
        throw std::invalid_argument("Use HTTPS /evaluate or loopback HTTP /evaluate with no query or fragment.");
    }
    if (!loopback && token.empty()) {
        throw std::invalid_argument(legacy ? std::string("Remote review endpoints require a token. ") + pairing
                                           : std::string("Remote review endpoints require AVENQUELLIS_GRADER_TOKEN."));
    }
    Client client(curl_easy_init(), curl_easy_cleanup);
    if (!client) throw std::runtime_error("Could not initialize review request.");
    Headers headers(nullptr, curl_slist_free_all);
    add_header(headers, "Content-Type: application/json");
    if (!token.empty()) add_header(headers, "Authorization: Bearer " + token);
    std::string response;
    const auto set = [&](CURLoption opt, auto value) {
        if (curl_easy_setopt(client.get(), opt, value) != CURLE_OK) throw std::runtime_error("Could not configure HTTP client.");
    };
    set(CURLOPT_CURLU, url.get());
    set(CURLOPT_HTTPHEADER, headers.get());
    set(CURLOPT_POST, 1L);
    set(CURLOPT_POSTFIELDS, request.data());
    set(CURLOPT_POSTFIELDSIZE, static_cast<long>(request.size()));
    set(CURLOPT_FOLLOWLOCATION, 0L);
    set(CURLOPT_NOSIGNAL, 1L);
    set(CURLOPT_CONNECTTIMEOUT_MS, 5000L);
    set(CURLOPT_TIMEOUT_MS, 65000L);
    set(CURLOPT_WRITEFUNCTION, append);
    set(CURLOPT_WRITEDATA, &response);
    if (loopback) set(CURLOPT_NOPROXY, "*");
    const auto status = curl_easy_perform(client.get());
    if (status != CURLE_OK) throw std::runtime_error(std::string("Review transport failed: ") + curl_easy_strerror(status));
    long http = 0;
    curl_easy_getinfo(client.get(), CURLINFO_RESPONSE_CODE, &http);
    if (http != 200) {
        // Loopback HTTP may need no token, so the pairing is named only once the endpoint answers 401.
        std::string error = "Review endpoint returned HTTP " + std::to_string(http);
        if (http == 401 && unsent_token && *unsent_token && token != unsent_token) error.append(". ").append(pairing);
        throw std::runtime_error(error);
    }
    return response;
}
