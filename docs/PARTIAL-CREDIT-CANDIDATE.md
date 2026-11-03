# Experimental point-ledger reviewer

`src/partial-credit.js` is a research candidate. Existing HTTP, Pages, browser-device and certificate routes keep their own protocols. Importing the package creates no network request. A hosted candidate evaluation needs an explicit trial flag, a server-side AI binding and an authorized budget.

## Marking policy

Each reader studies the whole proof before assigning points. A complete assessment must justify the weakest essential implication, cover all required cases and explain why the proposed method establishes the goal. A near-complete assessment describes a specific local repair. A partial assessment identifies a mathematically valid, independent result and explains which further step is missing. A name, example or asserted conclusion alone does not establish the conclusion. An unmapped alternate method or unresolved criterion can receive `CHECK` and a `null` point value.

The visible response is a compact JSON object with an `audit` and one `marks` row per supplied rubric criterion. Each row reports integer points `p` (or `null`), exact source-span IDs `s`, the established result `earned`, the validity and allocation explanation `why`, and the missing requirement `gap`. Trusted code resolves the excerpts and derives each status and the whole-proof category. The audit identifies the weakest implication examined or first essential gap. The format example uses two separately marked obligations from an unrelated inequality/equality problem. Each gap describes only its own criterion. A full row with a nonempty gap is inconsistent and the reading is withheld. Zero rows may explain why nothing was established; that text is a reader note and carries no earned credit. Each positive award needs a cited passage and an explanation of what follows from it. These are model judgments. The parser checks the shape of the evidence, bounds and consistency; it cannot prove the mathematical implication.

For an essentially complete argument, examine the defect and its repair in relation to the scheme. Avoid duplicating deductions simply because later lines propagate one earlier error. For incomplete arguments, credit independently justified results relevant to the source scheme. Boundary cases and equivalent alternate proofs deserve the same consideration as the reference method. If the problem’s prescribed route cannot be mapped fairly, request human adjudication. These practices adapt problem-specific coordination and qualitative olympiad marking guidance. Neither source certifies the software. [IMO regulations, section 7](https://www.imo-official.org/regulations/) · [UKMT BMO1 markers’ report, 2023](https://ukmt.org.uk/wp-content/uploads/2023/12/BMO1-2023-Markers-Report-.pdf)

HBCSE explains that it published draft marking schemes with the 2025 RMO solutions in error, and that regional committees could modify them during evaluation. For a problem with several valid solutions, encode mutually exclusive routes as alternatives within the same criterion. A reviewer can then award credit for the route the student used without adding points for several routes to the same result. The blinded study uses the published IMO-GradingBench guidance for each problem. [HBCSE’s notice on 2025 RMO marking](https://olympiads.hbcse.tifr.res.in/mathematical-olympiad-2025-2026/)

The original `question.rubric` descriptions and maxima stay authoritative. When a single seven-point holistic criterion lacks fixed numerical thresholds, the prompt supplies labelled **practice** anchors: zero for no established creditworthy progress, 1–5 for increasing substantive partial progress, six for a nearly complete proof with a minor repair, and seven for a complete proof. Other schemes can assign different numbers. Supply an explicit ladder for any nonstandard numerical exception instead of presenting the practice bands as official marks.

An optional server-owned `question.partialMarkingGuide` supplies such levels. Each declared ladder names its source, lists allowed point values (including zero and full) with their conditions, and may declare source-required minimum awards on other criteria. These conditions constrain the numerical ledger. They must come from a trusted educator or published problem-specific scheme, not the student’s answer.

```js
question.partialMarkingGuide = {
  version: 1,
  source: 'Authored classroom scheme, version 1',
  alternativeGuidance: 'An equivalent proof of this implication earns the same criterion marks.',
  criteria: [{id: 'conclusion', levels: [
    {points: 0, when: 'The conclusion is asserted without a valid deduction.'},
    {points: 2, when: 'The required conclusion follows from the proved lemma.',
      requires: [{id: 'lemma', atLeast: 2}]}
  ]}]
};
```

This example applies only to a question with matching `lemma` and `conclusion` rubric IDs and a two-point `conclusion` criterion. A positive result in a rubric slot still requires cited support. The exact proof and its logical relevance remain open to human review.

## Trial entry points

```js
import {makePartialCreditRequest, evaluatePartialCredit, PRIMARY_MODEL} from 'noether-proof-grader/partial-credit';

// Pure, suitable for tokenizer-based preflight before a budget is authorized.
const requestA = makePartialCreditRequest(question, answer, 0, {model: PRIMARY_MODEL, maxTokens: 2400});
const requestB = makePartialCreditRequest(question, answer, 1, {model: PRIMARY_MODEL, maxTokens: 2400});

// Call only on a server after a trial is explicitly approved and quota reserved.
const result = await evaluatePartialCredit({question, answer}, {env: {
  AI: env.AI, PARTIAL_CREDIT_TRIAL: 'enabled',
  EVALUATOR_MODEL: PRIMARY_MODEL, EVALUATOR_MAX_TOKENS: '2400', EVALUATOR_TIMEOUT_MS: '55000'
}});
```

`score` stays `null`. The primary consensus outcome `suggestedScore` requires two valid readings with identical marks on every criterion. `primaryProposal` and `auditProposal` expose individual totals as secondary diagnostics; one reader cannot silently supply a combined grade. An unresolved row has no numeric point value. Integer marks for other resolved criteria remain visible. `readers` contains the complete ledgers, and `reviews`, `criterionProposals` and `reviewerScoreRange` provide a presentation-compatible summary. Report coverage separately for primary diagnostic proposals and strict consensus, then report exact/within-one/absolute error only on eligible proposals. Never choose the metric after seeing human labels.

## Models and transport

The primary candidate is `@cf/qwen/qwen3-30b-a3b-fp8`. The published model card and authenticated Workers AI model-schema metadata support native `messages`, `max_tokens`, temperature, top-p, top-k and seed. The native chat completion shape includes visible `choices[0].message.content` and can supply separate `reasoning_content`. The trial appends Qwen’s documented `/think` soft switch after the mathematical data. The native request schema does not expose a hard `enable_thinking` toggle, so success and actual reasoning-field presence must be observed rather than assumed. Both calls cap generated tokens, including reasoning when accounted by the model, at the configured `max_tokens`. The primary trial uses 2,400 generated tokens per call, temperature 0.6, top-p 0.95, top-k 20 and different fixed seeds, 77101 and 77102. [Workers AI Qwen model](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/) · [Qwen publisher’s model card and soft-switch documentation](https://huggingface.co/Qwen/Qwen3-30B-A3B)

Only a completed visible assistant ledger is parsed. The code never scores the internal reasoning field. An unclosed inline thinking block, length termination, missing final content, invalid ledger or unsupported award yields a failed reading. Two separate calls receive identical math inputs and different marking priorities, and do not see one another’s responses. The code makes no automatic retries. A response deadline bounds client waiting; an upstream invocation can still finish and consume allowance.

`@cf/openai/gpt-oss-120b` is a predeclared fallback only if a synthetic compatibility check makes the primary transport unusable **before** the trial. Enable it deliberately with `PARTIAL_CREDIT_FALLBACK='synthetic-incompatibility'`. Its native bounded chat schema supports `messages` and `max_tokens`. That branch does not advertise a hard reasoning-effort setting, so no such field is sent. The separate Responses-like input advertises `reasoning.effort` but did not advertise an output cap in the retrieved native schema. A fallback must first demonstrate bounded generation and visible, completed final text on a synthetic check. The candidate does not automatically switch models, send both models the same submission or choose a model using test labels. Qwen returned two completed visible JSON ledgers on the synthetic development case. The frozen human-comparison trial uses Qwen only. Cloudflare’s explicit JSON Mode list does not name either candidate; the candidate therefore uses a compact prompted JSON protocol and strict local validation. [GPT-OSS 120B model](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/) · [Workers AI JSON Mode support](https://developers.cloudflare.com/workers-ai/features/json-mode/)

Cloudflare’s authenticated model search returned `@cf/qwen/qwen3-30b-a3b-fp8`, its embedding model and `@cf/qwen/qwen3.8-27b`. The specific attempted Qwen3-Next 80B identifier did not return a model schema. The trial does not assume a Qwen3-Next binding exists. No GPU inference is needed to read model metadata. [Workers AI model search](https://developers.cloudflare.com/api/resources/ai/subresources/models/methods/list/)

On 3 November 2026 the published prices were 4,625 input and 30,475 output neurons per million tokens for the Qwen primary, and 31,818 input and 68,182 output neurons per million tokens for GPT-OSS-120B. Estimate both readers, include the full configured output cap, model-specific chat framing and a conservative input buffer, and confirm the remaining account-wide free allocation before use. Workers Free stops when its daily allocation is exhausted. Workers Paid can bill overages. Prices, capacity and model availability can change. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## Local alternatives investigated

This machine has 16 GiB unified memory. A plausible research alternative is the 4-bit MLX conversion of Qwen2.5-Math-7B-Instruct. Its pinned safetensor weights total about 4.28 GB. The 4-bit Qwen3-8B conversion has about 4.61 GB of weights. Runtime buffers, context cache and the OS need additional memory. These are local model candidates, not tested transports or accuracy claims. Even ideal four-bit storage for 30 billion parameters is about 15 GB before overhead, leaving little headroom on this machine. Neither larger local model was downloaded or run in preparing this candidate. [Qwen2.5-Math publisher card](https://huggingface.co/Qwen/Qwen2.5-Math-7B-Instruct) · [Pinned MLX Math-7B conversion](https://huggingface.co/mlx-community/Qwen2.5-Math-7B-Instruct-4bit/tree/b144b9b952f8aa481cadb47e2eb6151d18a4de55) · [Pinned MLX Qwen3-8B conversion](https://huggingface.co/mlx-community/Qwen3-8B-4bit/tree/545dc4251c05440727734bcd94334791f6ab0192) · [MLX-LM](https://github.com/ml-explore/mlx-lm)
