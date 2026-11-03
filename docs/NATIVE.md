# Native proof grading backend

The C++20 library evaluates the two exact Veyra Math proof certificates, prepares arbitrary arguments for review, validates human marks and reconciles two model readings. The CLI can request both readings through the existing Veyra Math evaluation service. The browser and Cloudflare Workers continue to use their JavaScript entry points.

## Build and install

The library needs a C++20 compiler and CMake 3.20+. The CLI also needs libcurl 7.62+ development headers (on Debian/Ubuntu, `libcurl4-openssl-dev`). The repository includes the pinned JSON parser used by the CLI. Building the core requires no network access. Node 20+ enables the browser-parity and HTTP integration tests.

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
cmake --install build/native --prefix "$PWD/build/install"
```

Library-only consumers can configure with `-DNOETHER_GRADER_BUILD_CLI=OFF`. Use `find_package(NoetherGrader 0.7 CONFIG REQUIRED)`, link to `NoetherGrader::grader` and include `<noether/grader/grader.hpp>`. The installed-consumer test builds and executes an external project using the exported package. Debug builds can use `-DNOETHER_GRADER_SANITIZERS=ON` and `-DNOETHER_GRADER_WARNINGS_AS_ERRORS=ON`.

## Offline CLI

The executable is `veyra-grader`; the legacy `noether-grader` command still works. Each command reads one UTF-8 JSON request from a file, or stdin when the file is omitted or given as `-`. The question is the same JSON object used by the question engine. The result goes to stdout. Invalid requests and transport failures return exit code 2 and a JSON error on stderr. A valid but incomplete attempt is a successful request with no final score.

```sh
build/native/veyra-grader assess examples/checked-gcd.json
build/native/veyra-grader scaffold examples/checked-gcd.json
build/native/veyra-grader assess examples/human-review.json
build/native/veyra-grader finalize examples/human-review.json
```

The first command produces a checked 10/10. The third returns pending rubric rows. The fourth records the **explicit human decision** of 2/4 in the example, including the supplied reviewer and rationale. The library does not authenticate that identity. A caller with review authority must authenticate it before publishing a decision.

`assess` requires `{question,answer}`. For the two canonical generated question families it recognizes `VEYRA-PROOF/1` and the legacy `NOETHER-PROOF/1` and validates its original statement, rubric, weights, generator version, instance ID, seed, exam track, requested difficulty, parameter and field layout. For these two families the exact first generator draw determines k. Bank records also require their fixed bank seed, CMI track and canonical requested difficulty. Variants require a recognized exam, difficulty and variant/mock seed. The consecutive-product certificate checks every residue modulo 2 and 3 and an exact Bézout identity. The gcd certificate checks both integer affine identities for all positive inputs and the explicit equal-divisor-set inference. All arithmetic is exact under the grammar's bound of one million on coefficient magnitude. A partial certificate returns `lowerBoundPoints` and `score:null`; generic prose, a foreign statement or an unsupported template stays pending. Its field format uses ASCII names and signed decimal integers, space/tab coefficient delimiters, Unicode field-boundary whitespace, LF/CRLF lines and the same 2,048 UTF-16-unit limit as the browser. `scaffold` needs only `{question}`.

`finalize` accepts the full object shown in `examples/human-review.json`. Each criterion needs exactly one integer in its own range, and the rubric must sum to the question maximum. The native API uses signed `int` marks and limits submissions to 200,000 UTF-8 bytes. The JSON CLI also limits input to 1 MiB and 64 nesting levels, and rejects duplicate object keys. Hosted model review applies the smaller existing provider limits.

These checks establish agreement with the two generator templates. Anyone can generate valid practice questions. A public test service must look up the assigned reference in its trusted question catalog and use that record for grading. For variants the generator ID encodes the family and seed; proof-equivalent variants may share an ID across different exams and requested difficulties. Use the full assignment reference when those distinctions matter. Never trust the submission to select the rubric or identify an examiner. The existing Pages handler resolves server-owned references before invoking its evaluator.

## End-to-end free-form review

For free-form proofs, `review` sends the theorem, rubric, optional reference solution and answer to the explicitly configured Veyra Math `/evaluate` endpoint. It rechecks **both individual readings** from scratch. Each positive award needs a quote from the actual answer for that rubric row. The response must identify the same student answer and question. A suggested total exists only if two valid readings match on every criterion. A matching total with different allocations is still a disagreement. `score` stays null, including on agreement.

To run locally with your own already installed instruction model, start a chat-completions server that supports a JSON-schema response. For example, `llama-server` can serve compatible local GGUF weights. Use a locally available model path with an appropriate instruction chat template. The example assumes the server is running on port 8080 and limit settings fit your model and machine. [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

```sh
# Terminal 1, if a compatible local model and llama-server are already installed
llama-server --model "/path/to/your-instruct-model.gguf" --alias local-proof-model --host 127.0.0.1 --port 8080

# Terminal 2, at the grader repository root
EVALUATOR_BASE_URL=http://127.0.0.1:8080/v1 EVALUATOR_MODEL=local-proof-model \
  EVALUATOR_TOKEN_PARAMETER=max_tokens EVALUATOR_TIMEOUT_MS=60000 \
  node src/server.js

# Terminal 3
VEYRA_GRADER_URL=http://127.0.0.1:4175/evaluate \
  build/native/veyra-grader review examples/human-review.json
```

For a protected service set `VEYRA_GRADER_TOKEN` to the server's `EVALUATOR_ACCESS_TOKEN` in the caller's environment. Remote endpoints require HTTPS and a bearer token. Loopback HTTP is allowed. Redirects and automatic retries are disabled. Model-provider credentials stay in the service. A recognized certificate is handled locally by `review`, even when no endpoint is configured. A timeout may occur after the remote evaluator has already started its two readings.

To run a reproducible transport check immediately, without installing weights or using a provider account:

```sh
ctest --test-dir build/native --output-on-failure -R review-transport
```

This test starts a real authenticated Veyra Math service and a local scripted chat-completions endpoint. A fresh native CLI process submits the sample proof. The service issues two blind HTTP requests, and the CLI displays the validated outcome. The suite exercises agreed partial credit, disagreement, an invented quotation, an unauthorized client and an endpoint claiming unsupported full credit. Scripted responses establish transport and validation behavior. They provide no estimate of model accuracy.

`compare` is the offline alternative when two independent readings already exist. Supply `{question,answer,reviews:[readingA,readingB]}`. Each reading has `criterionScores`, `rationale` and `evidence:[{criterionId,quote}]`; a missing reading can be null. The output identifies this mode as `supplied_readings`. Actual `review` calls are identified as `backend_review`. Neither independence nor qualification of third-party reviewers can be established by their JSON.

## Validation scope

CTest compares 267 native outcomes with the browser verifier across 40 real bank/variant/mock records from the question engine, covering all 36 supported parameter settings, plus incomplete, adversarial and tampered inputs. The C++ tests exercise unsupported prose, human review, unknown criteria, overflow, same-total disagreements, missing readings and false quotations. These tests do not make free-form reasoning exact. Earlier human-labelled studies show both incorrect model proposals and abstentions. [Evaluation evidence and limitations](EVALUATION.md)
