# Score-only format diagnostic on six partial proofs

Qwen3 30B A3B FP8 returned a strict-agreement mark on **3 of 6** partial proofs. None matched the human research score. **One of the three** was within one point. Mean absolute error among agreed marks was 3.00 on a seven-point scale. The simplified output format made numerical error measurable. This study cannot qualify the model for student-facing proof grading. The previous release pilot failed its criteria and its confirmation labels remain sealed. [Original pilot report](../imo-partial-credit/pilot/README.md)

| Outcome | Valid / registered | Exact / valid | Within one / valid | Within one / registered | MAE on valid | Signed bias on valid |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reading 1 | 6/6 | 0/6 | 2/6 | 2/6 | 3.33 | 3.33 |
| Reading 2 | 4/6 | 0/4 | 1/4 | 1/6 | 3.50 | 3.50 |
| Strict agreement | 3/6 | 0/3 | 1/3 | 1/6 | 3.00 | 3.00 |

6/6 cases returned two native-binding receipts. Both readings supplied valid individual marks in 4 cases. They differed on 1. An abstention reduces coverage and per-registered success. It does not count as a zero mark. Signed bias is the model score minus the human score. The scorecard also reports results conditioned on receiving two server-side receipts. [Scorecard and case diagnostics](./scorecard.json)

| Case | Human | Reading 1 | Reading 2 | Strict agreement |
| --- | ---: | ---: | ---: | ---: |
| `r-fa17e13316e156b3` | 3 | 7 | — | — |
| `r-50a902296e433a0e` | 5 | 7 | 7 | 7 |
| `r-30a2423a2a31aa45` | 6 | 7 | 7 | 7 |
| `r-dc7ed9c628506805` | 1 | 7 | 6 | — |
| `r-33e70356ee3dc8d6` | 1 | 7 | 7 | 7 |
| `r-35f28ff310df593d` | 3 | 4 | — | — |

All ten valid individual readings awarded more marks than the human reference. The three strict-agreement scores were all 7/7, on responses that received 5/7, 6/7 and 1/7 from the research graders. In the last case the agreeing readers overgraded by six points. One other case produced 7/7 and 6/7 against a human 1/7, so strict consensus abstained. Reading 2 timed out on one case and returned incomplete output on another. Returning a number made mathematical error measurable without demonstrating reliable marking. This is a separate cohort, so it does not quantify a causal improvement or decline from the earlier pilot.

## Selection and limits

From the pinned 1,000-response IMO-GradingBench release we used source-tagged novel problems. All six selected problem families differ from the six families in the prior 19 fixtures; earlier offline-smoke response IDs and globally duplicated response texts were also excluded. A problem that appeared in an earlier offline smoke test with a different answer did not receive model inference in that test. Of 413 eligible remaining responses, 192 had partial marks. The custodian selected two responses in each 1–2, 3–4 and 5–6 band, with six distinct problem IDs, fixed salted ID ranking and independent presentation order. Both readers saw the complete original problem, model-authored submission, reference solution and common grading guidance, without the human mark or stratum. [Selection policy](./protocol.json), [source and fixture fingerprints](./manifest.json)

The two blind reads shared the same `@cf/qwen/qwen3-30b-a3b-fp8` model. The json wire, 2,400-token cap, exact module and all six cases were locked after a separate synthetic format control and before any trial call. Exact agreement requires two valid matching numbers. A valid but incorrect number remains an error. These six deliberately partial cases provide no endpoint, evidence-citation or feedback-quality test. The two readings of one model are not independent samples. Problem novelty relative to earlier cohorts does not establish that the public data were absent from model pretraining. These human research marks are not original official contestant grades. [Locked method](./locked-method.json), [exact frozen scoring module](./scalar.mjs)

## Reproduce without inference

The repository includes the scorer, aggregate logic and case-level numbers but no raw proof text, generated reasoning, model outputs beyond score/status, or transport credentials. Python 3.9+ and Node 20+ are sufficient for these commands. Run from this evidence folder. The first command downloads the immutable upstream CSV, verifies its byte fingerprint and separates regenerated blind inputs from labels. All generated source text stays in your chosen local directory.

```sh
run=$(mktemp -d)
python3 reproduce-fixtures.py --out "$run"
node request-hashes.mjs "$run" ./scalar.mjs "$run/case-hashes.json"
cmp "$run/case-hashes.json" case-hashes.json
python3 score.py --data-dir "$run" --predictions recorded-predictions.json \
  --expected-hash 1293284dc960b1383bebfa6b53e5b71d5af72dc678c1a97da1d7452e48002dcd \
  --wire json --out "$run/recomputed.json"
python3 - "$run/recomputed.json" <<'PY'
import json, sys
recorded = json.load(open("scorecard.json"))
rebuilt = json.load(open(sys.argv[1]))
for data in (recorded, rebuilt):
    data.pop("predictionSha256")
assert recorded == rebuilt
PY
```

The original blind run hash is in `locked-method.json`. The compact published prediction file omits raw transport metadata, giving it a different SHA-256. Removing that one fingerprint in the comparison above checks that every numeric result, case and coverage figure reproduces exactly. To inspect the input source locally, add `--source-file` with a copy of the pinned CSV. Do not rerun or tune the grading protocol and present the same six cases as a new held-out experiment.

IMO-GradingBench © 2025 Google LLC, CC BY 4.0. Adaptations are deterministic stratification, opaque identifiers, separate human targets and a shared holistic rubric wrapper. Each proof was originally written by an internal model and graded by human experts. Exact markers and per-row adjudication are not published. [Authors’ paper](https://aclanthology.org/2025.emnlp-main.1794/), [release and terms](https://github.com/google-deepmind/superhuman/blob/9b620a92886b3a7655b30ddcfe36e725e9596509/imobench/README.md), [pinned source CSV](https://raw.githubusercontent.com/google-deepmind/superhuman/9b620a92886b3a7655b30ddcfe36e725e9596509/imobench/gradingbench.csv), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
