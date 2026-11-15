# Avenquellis Proof Grader

The offline certificate checker awards exact marks for complete structured proofs in two original number-theory families. Free-form submissions use the proof-review service, with optional model-assisted mark proposals. Two blind reviewer calls assess the same answer against a problem-specific rubric. When every criterion score agrees, the service returns a **suggested score awaiting human review**. Disagreement, invalid evidence or transport failure produces no combined score. Teacher decisions are recorded through a separate validated review endpoint.

No CMI/ISI professor, olympiad examiner or benchmark has certified this software's grading accuracy. The tests verify transport, validation and review behavior. They do not establish mathematical marking accuracy.

## Native C++ backend

Build the C++20 backend with CMake. The `avenquellis-grader` CLI checks proof certificates, sends ungraded free-form proofs to a configured two-reader service, validates returned rubric evidence and records explicit human marks. The static library is available as `AvenquellisGrader::grader` through `<avenquellis/grader/grader.hpp>`. The legacy CMake target and header remain available. [Build, JSON examples and offline or networked workflows](docs/NATIVE.md)

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
build/native/avenquellis-grader assess examples/checked-gcd.json
```

## C++ grading in the browser and on Pages

The Pages proof API resolves the original question on the server and invokes the compiled grader before any model call. The same C++ module runs locally in the browser for offline certificate checks. Only complete certificates carry a checked final score. The two-reader model supplies provisional opinions which the native grader revalidates against exact evidence. [Build manifest, ABI and tests](docs/EDGE.md)

## Run locally

Node.js 20+ runs the offline review core and HTTP service without installed dependencies. The optional browser-model build and benchmark use the locked development packages installed by `npm ci`.

```sh
npm test
npm start
npm run benchmark -- --offline
```

The development service listens at `http://127.0.0.1:4175`. `PORT` changes the port. Browser code can import the offline `src/index.js`; provider integration belongs on a server.

To enable model evaluation against a compatible HTTP provider, copy `.env.example` to your ignored `.env`, enter your provider URL, explicit model and key, then run on Node 20.6+:

```sh
node --env-file=.env src/server.js
```

`POST /evaluate` sends the question, reference solution if present, rubric and answer to the configured provider twice. No provider requests occur through `/assess`, and no remote model was used during this repository's tests.

## Exact offline proof certificates

`src/certificate.js` is a standalone browser-safe module with no imports or network requirements. `certificateHelp(question)` returns instructions and a blank scaffold for a supported question. `verifyCertificate(question, answer)` verifies an explicit certificate and returns a score of 10 only when every required inference is established. Partial results have `score: null`, `lowerBoundPoints` for verified steps, and feedback for each criterion. Ordinary prose and unsupported questions return `null` and use the existing review workflow. Both implementations reconstruct the instance ID and parameter from the supplied generator seed. Bank questions must also match their original track and requested difficulty. A public service must resolve the assigned question from its own catalog before accepting marks.

```js
import {certificateHelp, verifyCertificate} from '@avenquellis/proof-grader/certificate';

const help = certificateHelp(question);
if (help) {
  // Show help.instructions and let the student fill in help.scaffold.
  const result = verifyCertificate(question, studentAnswer);
  if (result?.complete) console.log(result.score, result.maxMarks);
}
```

The first certificate line is `AVENQUELLIS-PROOF/1` (legacy `NOETHER-PROOF/1` remains supported). The next two fields identify the template family and its `k`. Use one named field per line, ASCII integer coefficients separated by spaces, and at most 2,048 characters total. Coefficients are capped at an absolute value of 1,000,000. The parser rejects duplicate or unknown fields and extra prose. A learner can submit another valid proof in the ordinary review workflow.

| Supported template | Certificate obligations | Marks |
| --- | --- | --- |
| `number-consecutive`, `1 ≤ k ≤ 12` | In `mod3` and `mod2`, supply a factor offset 0, 1 or 2 for every residue of `n`, in increasing residue order. `bezout` contains integer coefficients `u v` for `2u+3v=1`. | 4 for all residue classes modulo 3, 4 for both parity classes, 2 for using the identity with both verified divisibility claims. |
| `number-gcd`, `7 ≤ k ≤ 30` | `forward` gives `A B` for `A·n+B·(n+k)=k`. `reverse` gives `C D` for `C·n+D·k=n+k`. `conclusion` explicitly invokes `same-positive-divisors -> equal-maxima`. | 4 per universally valid affine identity, then 2 for applying the inference once both inclusions hold. |

For example, in an analogous modulo-five exercise with `k=2`, choosing offset `2` for residue `1` works because `1+2+2` is divisible by 5. The actual exercise requires a valid witness for **every** residue in each requested modulus. For the gcd family, the verifier compares the coefficient of `n` and the constant term exactly, so a combination that works at a single numerical value of `n` cannot pass.

The checker binds each theorem to its exact generated statement, bounded parameter, template version, proof type, maximum marks and rubric. It uses `BigInt` for each witness and identity. A complete residue proof covers negative and zero integers as well as positive ones. A complete gcd proof establishes equality of the two finite nonempty sets of positive common divisors. The automated score applies to these two certificate languages. It supplies no accuracy estimate for free-form proof marking.

## Configuration

| Variable | Meaning |
| --- | --- |
| `EVALUATOR_PROVIDER` | `http` (default) or `workers-ai` for a Cloudflare binding. |
| `EVALUATOR_PROTOCOL` | Workers AI only. Omit or use `verbatim-v1` for the original exact-quote protocol. Opt into `span-v2` for numbered evidence spans. |
| `EVALUATOR_BASE_URL` | HTTP provider API base ending at the API version, e.g. `https://api.openai.com/v1`. `/chat/completions` is appended. |
| `EVALUATOR_MODEL` | HTTP mode requires an explicit model supporting strict JSON-schema Chat Completions. Workers AI defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and also supports `@cf/meta/llama-3.1-8b-instruct`. |
| `EVALUATOR_API_KEY` | HTTP provider secret. Required for remote HTTP endpoints. The Workers AI binding supplies its own account access. |
| `EVALUATOR_TIMEOUT_MS` | Per-review deadline, default 25000; permitted range 50–60000. |
| `EVALUATOR_MAX_TOKENS` | Per-review completion cap. HTTP mode defaults to 4000 with range 256–12000. Workers AI defaults to 1536 with range 256–4000. Includes reasoning tokens where the provider does. |
| `EVALUATOR_TOKEN_PARAMETER` | `max_completion_tokens` by default. Choose `max_tokens` explicitly for a compatible provider that requires that legacy field. |
| `EVALUATOR_ACCESS_TOKEN` | Shared service secret. Required with at least 32 characters on public deployments. |
| `ALLOWED_ORIGIN` | One exact permitted browser origin. Defaults to `http://localhost:4173` locally; no browser origin is allowed by default on the public Worker. |
| `HOST` / `PORT` | Local Node binding; defaults `127.0.0.1:4175`. Public binding requires the service token. |

HTTPS is required for remote providers. HTTP is permitted only on localhost/127.0.0.1/::1. Redirects are rejected. Keys never appear in request payloads returned to the caller, client code, source-controlled configuration or error messages.

For the HTTP provider, the API request limit is 200KB. Evaluator input is further restricted to a 20,000-character answer, 15,000-character statement, at most 32 rubric criteria and a 65KB serialized mathematical payload. Each response is capped at 64KB and must contain well-formed UTF-8; malformed bytes are never replaced inside a review. The configured deadline bounds both fetch and response reading even when a custom transport ignores cancellation. Rejected-body cleanup is best-effort and cannot delay the error response. Two evaluations may be active per handler instance, and each evaluation makes two parallel reviewer requests with no automatic retries. This is an instance-level concurrency limit, not a distributed billing quota.

## API contract

- `GET /health` — mode, `evaluatorConfigured` and source references; contains no secrets.
- `POST /assess` — `{question, answer}` → offline review preparation, `status:'needs_review'`, `score:null`.
- `POST /evaluate` — `{question, answer}` → model-assisted proposals. Only available after configuration.
- `POST /review` — `{question, answer, criterionScores, reviewer, rationale}` → a validated human-assigned score. The supplied reviewer identity remains self-reported (`reviewerIdentityVerified:false`).

All POST routes require `Content-Type: application/json`. If a service token is configured, include `Authorization: Bearer <service token>` in server-to-server requests. Public deployments refuse POST requests until the token is configured. Provider credentials and the shared service token must remain on the website's backend; do not put them in static JavaScript or browser storage. The website backend must authenticate students/teachers and authorize review actions before proxying requests. This library does not implement user accounts, a database or institution-issued credentials.

A question needs a unique ID, statement, positive integer `maxMarks`, and a rubric whose positive integer points sum to that maximum:

```js
const question = {
  id: 'consecutive-product',
  statement: 'Prove n(n+1) is even for every integer n.',
  maxMarks: 7,
  rubric: [
    {id: 'parity', description: 'Justify that one factor is even, or equivalent divisibility.', points: 3},
    {id: 'conclusion', description: 'Deduce that the product is divisible by 2 for every integer.', points: 4}
  ]
};
```

An agreed model result has this shape:

```js
{
  status: 'awaiting_review',
  score: null,                       // never a final machine-certified grade
  provisionalScore: null,
  suggestedScore: 7,                 // proposal only; null on disagreement or failure
  suggestedCriterionScores: {parity: 3, conclusion: 4},
  reviews: [/* two validated proposals with exact evidence, rationale and gaps */],
  provenance: {model: 'configured-model', promptVersion: '...', expertValidated: false}
}
```

Each credited criterion must cite exact text from the submitted answer. Scores must be integer values within the rubric's bounds, all expected fields must be present, and additional fields are rejected. Incomplete generations, model refusals, invalid JSON and fabricated quotations are rejected. Valid JSON and verbatim evidence establish formatting and attribution; they do not prove the mathematical judgement is correct.

Both reviewers receive different audit instructions but the same isolated question/answer input. Neither receives the other's output. They currently use the same configured model; different prompts do not guarantee independent errors. The student answer is always untrusted data in the user message, never a system instruction. Prompt injection remains an evaluation concern; teacher moderation is required even if the proposals agree.

`assessProof` remains browser-safe and offline. It returns exact submission spans, the rubric and general writing prompts without guessing mathematical correctness from keywords or length. `runIndependentReview` remains available for custom evaluator functions. `evaluateProof` in `src/provider.js` supports both the compatible HTTP integration and native Workers AI.

## Browser-local proof review

A learner with a compatible GPU can explicitly download Qwen3 1.7B and run both reviewers in the browser. No model API key or inference service is required. Only model files and application assets are downloaded. The submitted proof and rubric remain in the browser during local inference.

The pinned quantized model has 968,001,536 weight bytes. Allow approximately 1 GB for the first download and at least 2.04 GB of GPU memory plus browser overhead. Loading requires a secure context and a WebGPU adapter with `shader-f16`. Browser storage can reuse the weights on later visits to the same origin, subject to eviction. A fresh browser profile or different site origin needs its own download. [Pinned model files](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/tree/80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc) · [WebLLM API reference](https://webllm.mlc.ai/docs/user/api_reference.html)

Build the optional runtime into a static asset directory:

```sh
npm ci
npm run build:device -- ../avenquellis-web/dist/device-runtime
```

The build bundles `@mlc-ai/web-llm@0.2.87`, retrieves a model library at an immutable upstream commit, verifies its SHA-256 digest and writes license files and provenance. It does not download language-model weights. Exclude `device-runtime/` from automatic offline precaching. The host needs same-origin script/WASM access, `'wasm-unsafe-eval'` for WebAssembly compilation and `connect-src` permission for `https://huggingface.co` and its `https://*.hf.co` regional CDN redirects. No external JavaScript loader is required. [WebLLM release](https://github.com/mlc-ai/web-llm/releases/tag/v0.2.87)

Display the download size and requirements before starting a review. Load the module when the learner selects local review:

```js
const {deviceModelInfo, deviceAvailability, gradeOnDevice, releaseDeviceModel} =
  await import('./device-runtime/device.js');
const info = deviceModelInfo();           // Metadata only, no model download.
const availability = await deviceAvailability();
// After the learner accepts the shown download size and availability.available is true:
const result = await gradeOnDevice(question, answer, progress => showStatus(progress.text));
// Optional after grading: await releaseDeviceModel() to free GPU resources.
```

The two reviewers run sequentially in separate reset chats with different instructions and the same original submission. They cite numbered submission spans. The verifier retrieves the exact text of those spans and validates criterion limits and supporting evidence. `suggestedScore` requires exact criterion agreement. `score` stays `null`, and disputed marks remain available for human review. This small model has a 4,096-token context window. Inputs beyond the local transport bounds are rejected before downloading the model. Truncated or incomplete model generations abstain. No student reasoning is silently shortened to fit.

In the preregistered 24-case TROJAN(H) pilot, this device model suggested marks on 12 cases and exactly matched three of those 12 expert marks. Its mean absolute error on suggested cases was 2.83 marks out of seven. All six suggested full-credit marks were wrong, including one expert score of zero. Keep these local opinions separate from assigned grades. [Pilot report and reproduction packet](benchmark/evidence/trojan-h/README.md)

For a local benchmark, run the installed Chrome executable against a separate persistent profile. This infers scores from `{id,question,answer}` fixtures and writes one prediction per row, including abstentions. It accepts no reference-label file. Lock the predictions before comparing them with human labels.

```sh
npm run benchmark:device -- \
  --fixtures fixtures.json --assets ../avenquellis-web/dist/device-runtime \
  --profile benchmark-results/chrome-profile --out benchmark-results/predictions.json \
  --chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --port 48173 --resume
```

Keep the same port, host and isolated profile to reuse cached model weights. The harness uses `127.0.0.1` and accepts an installed Chrome path on other operating systems. The local GPU and driver must support WebGPU and FP16. Progress is checkpointed atomically after each case. See [the evaluation protocol](docs/EVALUATION.md) for the interpretation of coverage, error metrics and examiner-label provenance.

## Research candidate for partial credit

A separate point-ledger experiment records what a proof establishes, what still needs repair and the exact basis for each proposed integer mark. It preserves independent reader opinions, validates source-specific point levels and prerequisites, and leaves the final mark open for human review. It is not imported by the production request handler. See [candidate design, model configuration and prerequisites](docs/PARTIAL-CREDIT-CANDIDATE.md).

## Native Cloudflare Workers AI

A Pages Function or standalone Worker can run both reviewers with an `AI` binding. The default model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The smaller `@cf/meta/llama-3.1-8b-instruct` is also supported. Both appear on Cloudflare’s JSON Mode model list. The native adapter sends the schema directly in `response_format.json_schema`, consumes the non-streaming `response` field, then validates every rubric mark and exact quotation locally. Cloudflare documents that JSON Mode can fail to satisfy a schema. [Workers AI JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)

The hosted protocol is versioned. `verbatim-v1` asks for exact quotations. `span-v2` sends numbered excerpts sliced from the original answer and asks for criterion points, one to three supporting span IDs and a short mathematical reason. The code resolves those IDs to exact text and applies the same score bounds and evidence checks. Invalid or missing spans cannot earn credit. Every positive criterion still needs support, and a total still requires both independent rubric proposals to agree exactly. A source pointer identifies the text but its mathematical relevance remains a model judgment. Both protocols return their identifier and prompt version in `provenance`. The V1 USAMO pilot offered 0/6 combined marks. One independently matched full-credit IMO worked example received 7/7. The initial three-case V2 preview failed at its request guard. A corrected, response-disjoint V2 pilot returned paired full marks on all three fresh proofs, against expert marks of 1, 2 and 1 out of seven. Its mean absolute error was 5.67/7. These studies do not demonstrate dependable free-form grading accuracy.

To select V2 in a Pages project, set `EVALUATOR_PROVIDER = "workers-ai"`, `EVALUATOR_PROTOCOL = "span-v2"` and bind `AI`. The package's `createPagesReviewHandler` forwards this server setting. The endpoint accepts no user-selected protocol. Include `src/span-v2.js` when copying the server-side module group. For the standalone Worker use the same variables in Wrangler `[vars]`. V2 exposes `invalid_json`, `invalid_schema`, `invalid_marks`, `invalid_span`, `missing_support`, `invalid_evidence` and existing timeout/quota codes to distinguish validation failures without returning raw failed model text. [Hosted benchmark evidence](benchmark/evidence/workers-ai/README.md)

Each evaluation makes two calls. `criterionProposals` shows each reviewer’s marks and quoted evidence. An individual criterion has `agreedPoints` only when both valid reviewers assigned it the same marks. The total `suggestedScore` requires agreement on **every** criterion. `reviewerScoreRange` gives the two proposed totals when both are available. This range has no calibrated probability interpretation. Both calls use one model and can share mathematical errors.

Daily allocation exhaustion, capacity limits, invalid model responses and timeouts leave the answer open for human review. Diagnostic codes include `daily_quota`, `provider_busy`, `invalid_output` and `timeout`. Neither pass is retried. A local deadline releases the caller, although an upstream inference may still finish and count toward account usage. Outstanding binding calls continue to count toward the four-call per-isolate limit until they settle, or until 60 seconds after their local deadline, because the runtime may cancel an unanswered subrequest without settling it. [Cloudflare Workers AI error codes](https://developers.cloudflare.com/workers-ai/platform/errors/)

**Cost.** On 3 November 2026, Cloudflare documents a free allocation of 10,000 neurons per day, resetting at 00:00 UTC. On Workers Free, operations fail after exhaustion. Workers Paid can bill additional usage. Select the Free account plan for a hard platform stop at the free allowance. A request count or token cap alone does not enforce a zero-cost policy on a paid account. Check the current allocation and model eligibility before enabling production inference. Local Wrangler calls with an actual AI binding also consume account usage. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Pages AI bindings](https://developers.cloudflare.com/pages/functions/bindings/#workers-ai)

### Pages Function integration

Bind Workers AI to your Pages project as `AI` and redeploy with that binding. A Pages Wrangler file uses the following binding section. The dashboard also supports separate production and preview bindings. [Pages configuration](https://developers.cloudflare.com/pages/functions/bindings/#workers-ai)

```toml
[ai]
binding = "AI"
```

Import `createPagesReviewHandler` from `@avenquellis/proof-grader/pages`, or vendor the Pages handler and its relative modules together outside the static asset directory. Supply the compiled grading runtime for native checks. Your Pages Function can export the returned handler as `onRequest`:

```js
import {createPagesReviewHandler} from '@avenquellis/proof-grader/pages';
import {resolvePracticeQuestion, reserveReviewAllowance, getNativeGrader} from '../../server/practice.js';

export const onRequest = createPagesReviewHandler({
  resolveQuestion: ({questionId, reference}) => resolvePracticeQuestion(questionId, reference),
  admit: ({request, env, question}) => reserveReviewAllowance(request, env, question),
  loadGrader: getNativeGrader
});
```

The `server/practice.js` callbacks belong to the host application. `resolvePracticeQuestion` retrieves or regenerates a canonical proof question from the server’s catalog. `reserveReviewAllowance` authenticates the caller as appropriate and atomically reserves its quota for two passes. Return `true` to admit, or a denial `Response` such as HTTP 429. A missing callback or failed admission prevents inference. The per-isolate limit is additional to the host’s account-wide quota.

The browser posts JSON `{questionId, answer, reference?}` to its same-origin endpoint. The optional reference is a bounded object of generation metadata for the host to validate. The handler rejects client-supplied rubrics, statements and models. The model sees only the resolved question and the submitted answer. A rejected or unavailable review leaves the local attempt available for later moderation.

Server code that already performs those checks can use `evaluateProof({question, answer}, {env: {AI: env.AI, EVALUATOR_PROVIDER: 'workers-ai'}})` directly. The public handler has no need for a provider key in browser code.

### Standalone Worker

`src/worker.js` serves the protected `/health`, `/assess`, `/evaluate` and `/review` routes. For native AI, select `wrangler.workers-ai.toml`, configure `EVALUATOR_ACCESS_TOKEN` as a secret of at least 32 characters, and deploy with that config. For an external HTTP provider, `wrangler.toml` retains the original mode. Set `EVALUATOR_BASE_URL`, `EVALUATOR_MODEL` and the `EVALUATOR_API_KEY` and `EVALUATOR_ACCESS_TOKEN` secrets. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

Unit and transport tests use simulated binding results and a local HTTP server. No production model grade or examiner accuracy measurement has been obtained from these tests.

## Benchmark CLI

The six fixtures cover correct, incomplete, invalid, alternate and adversarial submissions. `authoredExpectation` values are illustrative author-created expectations, **not examiner-certified human labels**, and the metric code never uses them as reference grades.

```sh
# No network calls, no score accuracy claim:
npm run benchmark -- --offline --out benchmark-results/offline.json

# Opt into two provider calls per fixture, using configured environment:
node --env-file=.env benchmark/run.js --live --out benchmark-results/live.json

# Evaluate saved proposals against separately supplied human labels:
node benchmark/run.js --predictions predictions.json --labels human-labels.json
```

`--fixtures fixtures.json` accepts a custom JSON array of up to 500 `{id,question,answer,category}` records. `--predictions` expects an array of `{id,suggestedScore}` with `null` for abstention. `--labels` expects records such as `{id:'parity-complete',score:7,source:'human',reviewer:'Reviewer identifier',adjudicated:true}`. Labels are caller-supplied; the tool cannot authenticate their author or expertise.

Reports include proposal coverage, coverage within the labelled subset, mean absolute error, root mean square error, exact agreement, agreement within one mark, signed error and overgrading rate. Error metrics are `null` unless human labels and corresponding proposals exist. The six small fixtures are a pipeline smoke test, not a representative accuracy study. See [the evaluation protocol](docs/EVALUATION.md) for the expert adjudication and held-out dataset needed before an accuracy claim.

## Sourced design

The [IMO General Regulations, §7](https://www.imo-official.org/regulations/) describe problem-specific schemes, independent assessment and coordination of disagreements. We adapt these workflow principles through separate proposals, validated rubric marks and human resolution.

The [UKMT BMO1 2023 markers' report, pp. 1–2](https://ukmt.org.uk/wp-content/uploads/2023/12/BMO1-2023-Markers-Report-.pdf) emphasizes coherent strategy, justification, gaps and meaningful partial progress. The reviewer prompts and checklist apply these principles. Its particular marking thresholds are not transplanted to CMI or ISI. Those exams need their own approved problem-specific schemes. Neither institution nor source endorses this software.

The transport implements [OpenAI's Chat Completions request/response contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [structured output format](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), with additional local validation. Other providers must support that contract, including strict schema responses; compatibility is not assumed from branding alone. Documentation checked on 3 November 2026.

## Reliability review — 7 November 2026

Rejected request bodies are cancelled without waiting for cleanup to finish. A stalled or failed cancellation can no longer hold an oversized-request response or replace the safe validation message. Early content-type/size failures and malformed UTF-8 discard their unread remainder. The 85 JavaScript tests, compiled edge artifact check, and four native CTest suites passed locally; tests used synthetic or local providers and made no paid model calls. The production-dependency audit reported no known vulnerabilities. These checks validate the implementation, not mathematical examiner accuracy or concurrent-user capacity.

## GitHub resource collection

Explore the project-specific [resource catalog](resources/README.md): curated references, star-ranked discovery, dated source metadata, cached failure recovery and an optional read-only server API. The repository includes a daily refresh workflow; hosted sites still follow their existing deployment process.
