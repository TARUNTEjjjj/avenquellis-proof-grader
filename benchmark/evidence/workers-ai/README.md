# Hosted proof-review comparisons

The V1 hosted reviewer offered no combined marks on six expert-scored USAMO research responses. It offered 7/7 on one published full-credit IMO proof. These are separate evaluations with different source populations and rubric designs. They cannot be pooled into a general accuracy estimate.

## Six-case V1 pilot

The six blind submissions span all six 2025 USAMO problems in the TROJAN(H) research set. These are research-crafted responses with human rubric scores. They are not six authenticated student examination scripts. The selection order, source commit and reproducible preparation are shared with the device pilot. [Source and preparation](../trojan-h/README.md) · [Selection hashes](../trojan-h/protocol.json)

We ran `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via the official Workers AI model endpoint, using the same production V1 prompts, response schema, local validators and agreement policy as the native binding. Each case received two independent readings capped at 900 output tokens. Model inputs contained each question, its rubric, reference solution and candidate response. The evaluator received neither the human mark nor the researchers’ case-specific justification. We hashed and locked all six predictions before joining the human scores. [V1 USAMO scorecard](v1-usamo-six.json) · [Cloudflare run endpoint](https://developers.cloudflare.com/api/resources/ai/methods/run/)

| Case | Human mark / 7 | Valid individual proposals | Combined suggestion |
| --- | ---: | --- | --- |
| trojan-h-014 | 5 | A: 7 | Abstained |
| trojan-h-002 | 1 | Both transports timed out | Abstained |
| trojan-h-034 | 5 | Neither output validated | Abstained |
| trojan-h-041 | 0 | B: 7 | Abstained |
| trojan-h-026 | 6 | Neither output validated | Abstained |
| trojan-h-021 | 3 | Neither output validated | Abstained |

Coverage was 0/6. Exact agreement and mean absolute error on combined suggestions are undefined because there were no such suggestions. The two valid individual proposals both overgraded their corresponding proofs. Two individual readings are insufficient for a separate accuracy estimate. On this identical six-case subset, the local device model offered 4/6 marks, matched two of those four exactly, and had mean absolute error 2.25/7 on offered marks. [Device pilot](../trojan-h/README.md)

**Validation diagnosis.** Ten HTTP requests completed with model responses. Eight failed the V1 `invalid_output` gate, which follows the nonempty-response and size checks and covers JSON parsing, rubric shape, marks and exact evidence. Two invalid readings used exactly the 900-token cap; truncation is possible but unconfirmed. The other six invalid readings used 472–814 tokens. Failed generations were not retained, so the record cannot distinguish inexact quotes from schema/score errors case by case. Two more REST calls timed out without an HTTP response. We kept those failures in the coverage denominator.

**Transport and usage.** A preliminary connection attempt produced no HTTP receipts and was stopped. Its returned infrastructure abstentions were preserved separately in the work log. We conservatively allocated up to 1,475.81 neurons to those attempted connections. The subsequent original six-case sequence reserved 2,895.23 neurons. Its ten successful HTTP receipts reported 1,984.92 neurons. Actual consumption for timed-out or interrupted requests is unknown. We reused the original case order and did not rerun any completed model reading.

## Published 2025 IMO P1 worked comparison

The blind fixture used the P1 proof transcribed and visually checked against pages 1–2 of DeepMind’s linked Gemini solution release. Both V1 reviewers gave 3/3 on existence and 4/4 on exclusion, producing a provisional 7/7 suggestion. These criterion weights are a research adaptation, not a separately published official marksheet. The prediction was locked before the reference label was joined. Two successful requests reported 323.21 neurons against a 514.4-neuron planning reservation. [Locked scorecard](v1-imo-example.json) · [Officially assessed Gemini result and linked release](https://deepmind.google/blog/advanced-version-of-gemini-with-deep-think-officially-achieves-gold-medal-standard-at-the-international-mathematical-olympiad/) · [Solution PDF](https://storage.googleapis.com/deepmind-media/gemini/IMO_2025.pdf)

The matched reference of 7/7 follows the publisher’s report of five perfect solutions and an officially assessed aggregate of 35/42, together with its directly linked P1–P5 release. The IMO president confirms the aggregate in that report. A separate signed per-item marksheet or checksum tying the published typesetting to the original submitted file was not available. One matched full-credit proof measures an individual example; it supplies no information about partial-credit calibration.

## Running the scorer again

Use the TROJAN preparation script with `--size 6` to regenerate the blind fixture sequence and its separate targets. Keep targets out of inference. Use `evaluateProof({question, answer}, {env})` from `src/provider.js` with `EVALUATOR_PROVIDER: 'workers-ai'`, the specified model, `EVALUATOR_PROTOCOL: 'verbatim-v1'`, `EVALUATOR_MAX_TOKENS: '900'`, `EVALUATOR_TIMEOUT_MS: '55000'`, and a server-side Workers AI `AI` binding. Save one row for every fixed case, including transport failures and abstentions; hash the complete predictions before running `score.py` against the targets. A fresh service call may produce different outputs and consumes the account's Workers AI allowance.

## Three-case V2 holdout

`span-v2` replaces the V1 quotation field with a list of source span IDs. Trusted code slices the submitted text at the recorded offsets and runs the same rubric/evidence validator. Each blind reviewer still checks the entire mathematical solution, and each positive award requires cited support. The final total requires exact agreement on every criterion. These changes version the protocol; they do not retroactively alter the V1 results or the separate device model prompt.

Three new USAMO research variants were selected by hash from the 24 cases left after excluding every item in the earlier 24-case device and six-case hosted samples. The fixed IDs were `trojan-h-004`, `trojan-h-010` and `trojan-h-027`, from three different problems. The 3-case blind fixture hash was `d190b89f02d3de19411d80d65da92617c01d119628287a016c4cd0d34ca45d62`. The sealed human labels remained outside the preview. No holdout example was retried or replaced.

The temporary Pages benchmark's authenticated status check succeeded, but all three case requests returned `preview_transport_failure` in 68–112 ms, without a provider-level payload or usage receipt. We froze these three abstentions before joining the reference marks. Coverage is 0/3; agreement and error on offered scores are undefined. The client’s exception handler collapsed transport, HTTP and invalid-response errors into one label and did not preserve the actual HTTP statuses or response bodies. This experiment therefore cannot establish V2 mathematical accuracy or show that it improves on V1. The 1,520.15-neuron figure is a planning reservation, not a usage measurement. [V2 scorecard](v2-heldout-three.json)

For instrumented uses of V2, set `EVALUATOR_PROTOCOL='span-v2'` on the server. `makeSpanReviewRequest` in `src/span-v2.js` constructs the exact payload used by the native reviewer and is available for token budgeting. `resolveSpanReview` rejects unknown or duplicate references, out-of-range scores, missing positive-credit support and malformed row shapes before final evidence validation. Native results carry their protocol and prompt version in `provenance`. A new prospective study should preserve specific transport/status diagnostics before any claim about coverage or accuracy.
