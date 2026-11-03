# Veyra Math native grading on Pages

The desktop CLI, browser and Pages use the same C++ implementation for certificate assessment and review reconciliation. The compiled ABI exposes three operations: assess a proof, prepare a scaffold, and validate two backend readings. The ABI contains no model weights or credentials.

The Pages host resolves the question ID and optional generator reference from its own native catalog. `POST /api/assess` returns a structural result for prose or checks a recognized certificate entirely in C++. `POST /api/grade` also checks certificates first. For other proofs the existing admission policy reserves the two hosted model calls. Their responses then pass through the C++ validator. If either reading is invalid or the per-criterion decisions differ, `suggestedScore` is null. Even unanimous model proposals have `score:null`. Native unavailability is an explicit service error. The existing human-labelled evaluation remains the measure of mathematical accuracy. On-device readings use the same native comparison and output policy.

Both routes accept `{questionId, answer, reference?}`. The client cannot supply a rubric, theorem, comparison readings or final marks. On supported certificates `lowerBoundPoints` reports proved progress, and `score` is present only on completion. Native responses include `provenance.nativeGrader` with the value `veyra-grader-wasm/1`. Old saved certificates prefixed with `NOETHER-PROOF/1` remain valid; new scaffolds use `VEYRA-PROOF/1`.

## Reproduce

The `edge` directory contains verified Emscripten 6.0.13 output plus a manifest with source and artifact SHA-256 hashes. Its source commit is recorded in `edge/source-commit.txt`. The native build workflow installs the pinned official SDK and runs both certificate formats and evidence validation before returning an artifact.

```sh
# With the official 6.0.13 SDK installed and activated
EMSDK=/path/to/emsdk npm run build:edge
npm run check:edge
npm test
```

`instantiateGrader(compiledModule)` accepts a precompiled `WebAssembly.Module`. A Workers bundle statically imports the binary as a module, avoiding runtime compilation. A browser can instead supply bytes through the offline-capable loader. After initialization, `assess(question,answer)`, `scaffold(question)` and `compare(question,answer,reviews)` are synchronous. The runtime caps a single input at 1 MiB and Wasm memory at 64 MiB. [Cloudflare's JavaScript WebAssembly interface](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/)

The regression suite checks the committed artifacts and inputs against their hashes, exercises the actual Wasm for forty canonical bank/variant/mock records and checks fabricated evidence, score disagreements and legacy proofs. These tests establish execution and scoped inference-rule behavior. Accuracy on unrestricted olympiad prose still requires human-labelled evaluation. [Existing evaluation evidence](EVALUATION.md)
