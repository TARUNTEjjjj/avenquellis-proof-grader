# Five-case paired pilot against IMO-GradingBench human scores

The human labels stayed separate until the registered predictions were frozen. All cases are model-written solutions scored by human research graders. These are not official contestant marks. [Original study](https://aclanthology.org/2025.emnlp-main.1794/), [published source and terms](https://github.com/google-deepmind/superhuman/blob/9b620a92886b3a7655b30ddcfe36e725e9596509/imobench/README.md)

The preregistered pilot gate **did not pass**. Details of each gate and denominator are recorded in [the scorecard](./scorecard.json) and [the decision policy](./decision.json).

| Population and method | Proposed / registered | Exact / scored | Within one / scored | Within one / registered | MAE on scored | Signed bias on scored |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| all · baseline | 0/5 | — | — | 0/5 | — | — |
| all · candidate | 0/5 | — | — | 0/5 | — | — |
| partial · baseline | 0/3 | — | — | 0/3 | — | — |
| partial · candidate | 0/3 | — | — | 0/3 | — | — |
| zeroEndpoint · baseline | 0/1 | — | — | 0/1 | — | — |
| zeroEndpoint · candidate | 0/1 | — | — | 0/1 | — | — |
| fullEndpoint · baseline | 0/1 | — | — | 0/1 | — | — |
| fullEndpoint · candidate | 0/1 | — | — | 0/1 | — | — |

MAE and signed bias are measured in marks out of seven. Abstentions reduce coverage and per-registered success. A dash indicates no numerical estimate was possible. Paired differences are defined only on responses both systems scored.

## What happened to the readings

Both methods abstained on all five registered responses. Exact agreement, within-one agreement, mean absolute error and bias **among suggested marks** are undefined. Neither method offered a mark within one on any of the three registered partial answers. There were no jointly scored cases for a paired numerical comparison. The human partial scores were 1, 4 and 5 out of 7. The endpoint scores were 0 and 7.

Each method received three HTTP 200 responses bearing two native binding receipts, including two of the three partial cases. Neither method could suggest a mark on either of its two reached partials. The baseline produced one valid individual reading among its six returned readings, proposing 5/7 on the response the human marked 1/7. Its other five readings failed validation. The candidate returned three invalid mark ledgers, one invalid span and two incomplete outputs. None of its six readings qualified as a valid individual mark. Two requests per method ended in a client transport failure. Outcomes that never returned from the client cannot establish a mathematical model judgment. Both methods reached the same human 1 and 7 cases; only the baseline reached human 4, only the candidate reached human 5, and neither reached human 0. [Transport and reading-level diagnostics](./transport.json)

No responses were retried. The confirmation phase was not run and its labels remain sealed. The pilot did not support introducing the candidate as the default numerical proof grader. Neither candidate nor baseline has a measurable magnitude of final-score overgrading or undergrading on this cohort because both abstained throughout. Two gate checks passed vacuously: there was no offered large error, and neither method had more within-one partial proposals than the other. The coverage, partial-credit and endpoint requirements failed.

## Methods

Cases came from six research-authored problems labeled `Novel Problem` in the pinned source. The whole study excluded problem IDs exposed in the previous IMO smoke test, normalized duplicate responses, modified older IMO problems and USAMO 2025 problems overlapping earlier experiments. Among 186 initially eligible response rows, 181 passed all filters. We stratified by published human marks, ranked original IDs deterministically within bands, anonymized problem/case IDs, and used an independently hashed presentation order. The pilot used three interior-score bands and two endpoint controls across five distinct problems. The confirmation has twelve interior cases and two endpoint controls across all six problems. It has no responses in common with the pilot but shares five problems. [Selection manifest](./selection.json), [frozen methods and prediction checksums](./provenance.json)

Both systems receive the same complete source problem, candidate text, reference solution and common marking guidance. The guidance is represented as one holistic criterion worth seven points. The original study reports a four-category grading task. This experiment instead measures raw integer-score agreement with human labels. Raw text, prompts, rationales, credentials and inference logs are excluded from this packet.

The production baseline used the free-form verbatim protocol with two Llama 3.3 70B readings. The experimental candidate used Qwen3 30B A3B FP8 with `noether-point-ledger-2026-11-03-candidate3` and two readings capped at 2,400 output tokens. The baseline capped each output at 900 tokens. Agreement by two readings of the same model can still be mathematically wrong. This comparison changes both the model and the scoring protocol.

IMO-GradingBench © 2025 Google LLC. Adaptations include anonymized IDs, numerical score stratification and a holistic rubric wrapper. [CSV at the frozen revision](https://raw.githubusercontent.com/google-deepmind/superhuman/9b620a92886b3a7655b30ddcfe36e725e9596509/imobench/gradingbench.csv), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
