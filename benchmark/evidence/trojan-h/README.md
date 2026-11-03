# Blind comparison against human research marks

The browser-local Qwen3 1.7B reviewer proposed a mark for **12 of 24** human-rated proof variants (50% coverage). Only **3 of the 12** proposed marks matched the reference exactly. This run does not support using the local model to assign final marks to students.

| Device pilot | Result |
| --- | --- |
| Candidate responses | 24, four per problem across the six 2025 USAMO problems |
| Suggested a score | 12/24 |
| Abstained | 12/24, including 11 rubric disagreements and one interrupted browser run |
| Exact match among suggestions | 3/12 (25%) |
| Within one point among suggestions | 5/12 (41.7%) |
| Mean absolute error among suggestions | 2.83 points on the 0–7 scale |
| Mean signed error among suggestions | +1.50 points (model minus human) |
| Over / under / exact among suggestions | 6 / 3 / 3 |
| Largest error | 7 points |

All six suggested full marks were incorrect. The six human reference scores were 0, 1, 2, 3, 4 and 6. For `trojan-h-017` both readings proposed 7/7 and the reference was 0/7. For `trojan-h-034` both readings proposed 0/7 and the reference was 5/7. The two readings use the same weights and share failure modes. [Case-level results and marks](./device-24.json)

## What was measured

TROJAN(H) contains 48 human-researcher-authored variants of proofs for six USAMO 2025 problems. Its researchers introduced errors and published expert-awarded whole-number scores from 0 to 7. The authors describe two annotators but do not publish an individual second-reader or adjudication status for every example. These responses are distinct from official contestant scripts. The paper's separate machine-generated split was excluded. This evidence does not measure grading agreement with CMI, ISI or RMO examiners. [Paper, §§4.1–4.2](https://arxiv.org/html/2610.36767v1), [pinned original release](https://github.com/aziksh-ospanov/TROJAN/tree/1f2bcb982bfc4ddcbac764609243f200dd5219fb)

The sampling procedure hashed case IDs within each problem, hashed the problem IDs and interleaved cases by problem. It was fixed before inference. We took the first 24, preserving the nested six-case cohort available for hosted comparisons. The model saw each problem, its researcher-supplied sample solution, its original additive marking scheme and the candidate response. Human marks and the source's case-specific grader justification were withheld until the predictions were locked. This is a publicly available dataset and possible training exposure cannot be ruled out. Selection spans six problems, so inference to other mathematics or examiners is limited. [Selection and hashes](./protocol.json)

The device was a macOS ARM64 machine with Chrome 156.0.8078.80 and Apple WebGPU. WebLLM 0.2.87 ran `Qwen3-1.7B-q4f16_1-MLC` at revision `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc`. Prompt identifier `noether-device-proof-2026-11-03-v1` used two fresh chats, seeds 991 and 992, temperature 0.15 and a 650-token cap per reading. The model produced criterion marks with pointers to submitted text. The software suggested a total only when both validated readings agreed on every criterion. Published metrics condition on suggested scores and report coverage separately. Runtime or reviewer failure remains in the denominator. [Device implementation](../../../src/device.js), [MLC model revision](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/tree/80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc)

After the first 14 completed records, the browser reported an abort during `trojan-h-033` and produced no completed result. We kept that selection as a runtime abstention. Its elapsed time and reviewer marks are unknown. We loaded a fresh browser page to finish the remaining nine with a timeout-hardened wrapper. The model, prompt, scoring policy, cohort and labels stayed fixed. Of the 23 cases with measured times, median end-to-end time was 17.6 seconds on this device. Hardware differences can change runtime and model output.

## Reproduce

From the grader repository root, Python 3.10+, Node 20+, Chrome with WebGPU and sufficient GPU memory are required for new inference. About 1 GB of model assets is downloaded on first use. Regenerating data and verifying the recorded metrics require only Python's standard library. The script verifies the source SHA-256 and compares the complete blind fixture bytes to the locked SHA-256. The exported `targets.json` must stay outside the inference process.

```sh
packet=benchmark/evidence/trojan-h
run=benchmark-results/trojan-h-device-24
python3 "$packet/prepare.py" --size 24 --out "$run"
python3 "$packet/score.py" "$run/targets.json" "$packet/device-24.json" --out "$run/recomputed.json"
cmp "$run/recomputed.json" "$packet/device-24.json"

npm ci
npm run build:device
node benchmark/device-browser.mjs --fixtures "$run/fixtures.json" \
  --assets build/device-runtime --profile "$run/chrome-profile" \
  --out "$run/fresh-predictions.json" --port 48173 --resume
python3 "$packet/score.py" "$run/targets.json" "$run/fresh-predictions.json" --out "$run/fresh-report.json"
```

On other operating systems, pass `--chrome` and the path to a compatible Chrome executable. Supported fixture sizes are 6, 12, 24 and 48. To verify the first six cases of the original device pilot, use size 6 and the first six predictions in `device-24.json`; four received suggestions, two matched exactly and mean absolute error was 2.25 points on scored cases. Keep any future prompted or tuned runs separate from these recorded results. Ospanov et al. published the source repository under the [included MIT license](./TROJAN-LICENSE.txt). The adaptation separates inputs and labels, changes field names and publishes metrics. No proofs or grader justifications are redistributed here.
