# Evaluation and release protocol

The offline benchmark smoke test, local HTTP transport tests and simulated native Workers AI binding tests have run successfully. A separate real browser-local Qwen3 pilot uses blind human-scored fixtures. Its results must be reported with coverage, sample size and source population. The native Workers AI adapter was also evaluated on a separate locked six-case USAMO cohort and a published IMO solution. Unit tests use a simulated binding. [Hosted study](../benchmark/evidence/workers-ai/README.md) The tests verify workflow, transport and validation; they do not establish mathematical grading accuracy. The runnable CLI is documented in the repository README. It omits error metrics without separately supplied human labels.

The separate `AVENQUELLIS-PROOF/1` certificate checker (legacy `NOETHER-PROOF/1` and `VEYRA-PROOF/1` headers are still accepted) proves bounded structured claims for two authored template families using integer arithmetic. Its regression fixtures were captured from the original question bank. They cover alternative valid Bézout pairs, complete residue coverage, malformed and partial inputs, tampered problem statements or rubrics, both inclusions for gcd, and spurious linear combinations that agree at one input but fail identically. Certificate scores should be reported separately from model-assisted grading metrics. The fixtures do not measure how closely the model grades free-form proofs relative to examiners.

1. Recruit qualified mathematical proof evaluators and document their relevant experience. Do not call reviewers CMI/ISI faculty unless their actual affiliations support that statement.
2. Collect consented, anonymized submissions across algebra, geometry, number theory, combinatorics, calculus and probability. Include correct alternate proofs, short elegant proofs, long invalid proofs, partial progress, missing cases, circular arguments and deliberately irrelevant instructions.
3. Have two experts mark every submission independently against an approved problem-specific rubric. Resolve disagreement with a third expert and retain the original marks as well as the adjudicated reference.
4. Split train/development/test by problem and template family, not merely by answer. Otherwise nearly identical generated variants can leak into the evaluation set. Keep the held-out test set inaccessible during prompt and rubric development.
5. Evaluate total and criterion-level mean absolute error, exact agreement, agreement within one mark, weighted Cohen's kappa, overgrading of invalid proofs, and recall of substantial logical flaws. Report counts and confidence intervals, and stratify by subject, proof type, score band and language. Assess robustness to alternate valid approaches separately.
6. Measure abstention coverage and error on the subset the system proposes to score. A high agreement figure obtained by sending most answers to humans is not a high-coverage automated grader. Model self-reported confidence is not a calibrated probability.
7. Compare with expert-to-expert disagreement and publish the benchmark version, rubric version, provider/model versions, prompt versions, sample size and limitations. Set release thresholds in advance with the educators who will use the tool.
8. Use teacher moderation during pilot operation, retain corrected decisions and monitor regressions. Store the original answer, exact rubric, score breakdown, reviewer identity and rationale with immutable revision history in the production backend.

A future formal-proof integration can mechanically verify a proof represented in a supported proof assistant. It does not make an arbitrary natural-language or handwritten submission formally verified. OCR introduces an additional error source and is not included in this release.

## Stratified report

`node benchmark/run.js ... --stratified` (or `computeStratifiedReport` in `benchmark/stratified.js`) implements the reporting part of step 5 (and the abstention coverage of step 6). Without the flag the report is unchanged. Version 1 is defined as follows.

**Inputs.** All new fields are optional and validated only when present.

- Prediction: `criterionScores` maps a rubric criterion id of the fixture's question to an integer in `0..points`, or `null` when unresolved. `flawDetected` is a boolean: whether the system flagged a substantial logical flaw.
- Human label: `criterionScores` uses the same keys but no `null`; omit an unmarked criterion. `substantialFlaw` is the adjudicated boolean annotation. `strata` may contain `subject`, `proofType` and `language`, each a non-empty string of at most 100 characters.
- `scoreBand` is derived, never supplied: `zero` (score 0), `partial` (between 0 and `maxMarks`) and `full` (`maxMarks`).

**Populations.** `overall` covers every labelled case. `strata.<dimension>.<level>` covers the labelled cases at that level. A missing `subject`, `proofType` or `language` is grouped as `unspecified`. All three score bands are always listed. Other levels appear only when at least one label uses them.

**Metrics per population.**

- `counts`: labelled, proposed (non-null `suggestedScore`), abstained (`null`) and missing predictions. `coverage` is proposed/labelled.
- `total`: compared count, mean absolute error, root mean square error, mean signed error (suggested minus human), exact agreement, agreement within one mark, overgrading rate and weighted kappa. Only labelled cases with a proposal are compared.
- `criteria.byCriterion["<question id>/<criterion id>"]`: the same metrics for one criterion. A pair requires integer criterion scores from both the label and the prediction, so an abstaining prediction can still contribute resolved criteria. `coverage` is compared/labelled for that criterion. `criteria.pooled` pools every criterion pair for error and agreement. It has no kappa because criteria use different scales.
- `substantialFlaw`: annotated and flawed label counts, flawed cases without a boolean `flawDetected`, `recall` (detected / flawed cases with a signal) and `overgradedWhenProposed` (flawed cases whose proposal exceeds the human mark / flawed cases with a proposal). Missing signals are counted, not treated as misses.

**Weighted kappa.** Cohen's kappa with quadratic weights `(i-j)^2/K^2` over integer categories `0..K`, where `K` is the shared maximum (`maxMarks` for totals, criterion points for criteria). Quadratic weights penalize large mark differences more than adjacent ones. Kappa is `1 - observed/expected` weighted disagreement, with expected disagreement taken from the product of the two marginal distributions.

**Confidence intervals (95%).** Proportions use the Wilson score interval without continuity correction. Means, RMSE and kappa use a percentile bootstrap over cases: 2,000 resamples with replacement, a mulberry32 generator restarted at seed `20261119` for each interval, cases ordered by id, and type-7 linear-interpolation quantiles. The same inputs therefore produce the same report in any order. Bootstrap intervals are approximate for small samples and should not be used to claim a release threshold on their own.

**Null outcomes.**

- No human labels: `stratified` is `null`.
- A population or criterion with no compared pairs, including an empty score band: `compared` is 0 and every estimate and interval is `null`. A proportion with denominator 0 has `rate:null` and `ci95:null`.
- Kappa is `null` with `reason` `no_compared_pairs`, `mixed_scales` (questions with different maxima in one population) or `degenerate_denominator` (zero expected disagreement, for example both raters giving one identical mark, or `K = 0`). Bootstrap resamples with a degenerate denominator are discarded, and the kappa interval is `null` with `reason:'degenerate_bootstrap'` if fewer than half remain.

`test/fixtures/stratified-metrics-synthetic.json` is a six-case synthetic set whose expected values were worked out by hand and listed in its `derivation` field. `test/stratified-metrics.test.js` checks the report against them. These fixtures check the arithmetic only and make no accuracy claim.
