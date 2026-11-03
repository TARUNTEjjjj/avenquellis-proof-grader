# Noether Proof Grader

A working mathematical proof-review service with optional model-assisted score proposals. Two blind reviewer calls assess the same answer against a problem-specific rubric. When every criterion score agrees, the service returns a **suggested score awaiting human review**. Disagreement, invalid evidence or transport failure produces no combined score. Teacher decisions are recorded through a separate validated review endpoint.

No CMI/ISI professor, olympiad examiner or benchmark has certified this software's grading accuracy. The tests verify transport, validation and review behavior. They do not establish mathematical marking accuracy.

## Run locally

Node.js 20+; no runtime dependencies. Offline review preparation requires no API key.

```sh
npm test
npm start
npm run benchmark -- --offline
```

The development service listens at `http://127.0.0.1:4175`. `PORT` changes the port. Browser code can import the offline `src/index.js`; provider integration belongs on a server.

To enable actual model evaluation, copy `.env.example` to your ignored `.env`, enter your provider URL, explicit model and key, then run on Node 20.6+:

```sh
node --env-file=.env src/server.js
```

`POST /evaluate` sends the question, reference solution if present, rubric and answer to the configured provider twice. No provider requests occur through `/assess`, and no remote model was used during this repository's tests.

## Configuration

| Variable | Meaning |
| --- | --- |
| `EVALUATOR_BASE_URL` | Required API base ending at the API version, e.g. `https://api.openai.com/v1`. `/chat/completions` is appended. |
| `EVALUATOR_MODEL` | Required, explicit model supporting strict JSON-schema Chat Completions. No hidden model default. |
| `EVALUATOR_API_KEY` | Server-side provider secret. Required for remote endpoints; optional for a local compatible model server. |
| `EVALUATOR_TIMEOUT_MS` | Per-review deadline, default 25000; permitted range 50–60000. |
| `EVALUATOR_MAX_TOKENS` | Per-review completion cap, default 4000; range 256–12000. Includes reasoning tokens where the provider does. |
| `EVALUATOR_TOKEN_PARAMETER` | `max_completion_tokens` by default. Choose `max_tokens` explicitly for a compatible provider that requires that legacy field. |
| `EVALUATOR_ACCESS_TOKEN` | Shared service secret. Required with at least 32 characters on public deployments. |
| `ALLOWED_ORIGIN` | One exact permitted browser origin. Defaults to `http://localhost:4173` locally; no browser origin is allowed by default on the public Worker. |
| `HOST` / `PORT` | Local Node binding; defaults `127.0.0.1:4175`. Public binding requires the service token. |

HTTPS is required for remote providers. HTTP is permitted only on localhost/127.0.0.1/::1. Redirects are rejected. Keys never appear in request payloads returned to the caller, client code, source-controlled configuration or error messages.

The API request limit is 100KB; evaluator input is further restricted to a 20,000-character answer, 15,000-character statement, at most 32 rubric criteria and a 65KB serialized mathematical payload. Each response is capped at 64KB. Two evaluations may be active per handler instance, and each evaluation makes two parallel reviewer requests with no automatic retries. This is an instance-level concurrency limit, not a distributed billing quota.

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

`assessProof` remains browser-safe and offline. It returns exact submission spans, the rubric and general writing prompts without guessing mathematical correctness from keywords or length. `runIndependentReview` remains available for custom evaluator functions. `evaluateProof` in `src/provider.js` provides the real compatible HTTP integration.

## Cloudflare Worker

`src/worker.js` and `wrangler.toml` are ready for a standalone Worker. They use standard Fetch APIs and require no Node compatibility flag. With Wrangler installed and your Cloudflare account connected:

1. Set `EVALUATOR_BASE_URL`, `EVALUATOR_MODEL` and, if needed, `ALLOWED_ORIGIN` under `[vars]` in `wrangler.toml`.
2. Set secrets interactively with `wrangler secret put EVALUATOR_API_KEY` and `wrangler secret put EVALUATOR_ACCESS_TOKEN`.
3. Run `wrangler deploy`.

Follow [Cloudflare's secrets instructions](https://developers.cloudflare.com/workers/configuration/secrets/) and [Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/). Keep secrets out of `[vars]` and source control. Local Wrangler `.dev.vars` files are ignored.

The Worker can be considered for Cloudflare's Free plan subject to its [current request, CPU and subrequest limits](https://developers.cloudflare.com/workers/platform/limits/). The external model provider has separate costs and quotas; Cloudflare hosting does not make model inference free. A compatible local model can avoid per-call API charges when running the Node service, but a hosted Worker cannot reach your computer's localhost. No account, paid plan or production deployment is created by this repository.

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
