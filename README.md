# Noether Proof Grader

A working proof-review workflow for the Noether preparation platform. It prepares submitted text for rubric-based marking, preserves evidence, validates human-assigned partial marks, and supports two independent external reviewer adapters. It does **not** automatically determine whether a free-form mathematical proof is correct. No CMI/ISI professor, olympiad examiner, institution, or accuracy benchmark has certified this software.

## Run

Node.js 20+; no dependencies or API key required.

```sh
npm test
npm start
```

The development API listens at `http://127.0.0.1:4175`. `PORT` changes the port. `ALLOWED_ORIGIN` permits one frontend origin (default `http://localhost:4173`). It is a local development service, with no persistence or reviewer authentication. A production deployment must authenticate teachers, authorize review actions, store submissions and audit events, and enforce data-retention and request-rate policies. Browser code can import `src/index.js` directly.

## API

- `GET /health` — service mode and marking sources.
- `POST /assess` — JSON `{question, answer}`; returns unscored review preparation.
- `POST /review` — JSON `{question, answer, criterionScores, reviewer, rationale}`; validates and records a human score. The reviewer name is self-reported (`reviewerIdentityVerified:false`).

Question schema:

```js
const question = {
  id: 'consecutive-product',
  maxMarks: 7,
  rubric: [
    {id: 'parity', description: 'Explain why one of two consecutive integers is even.', points: 3},
    {id: 'conclusion', description: 'Deduce divisibility of the product by 2.', points: 4}
  ]
};
```

The rubric points must sum to `maxMarks`. Each criterion ID must be unique. Each reviewed score must be an integer between zero and that criterion's maximum. Marks reflect the supplied rubric's scale; the software does not impose IMO's scale on CMI or ISI questions.

```js
import {assessProof, finalizeReview} from './src/index.js';
const answer = 'One of the consecutive integers is even, so their product is even.';
const pending = assessProof({question, answer});
// pending.status === 'needs_review'; pending.provisionalScore === null
const reviewed = finalizeReview({
  question, answer, criterionScores: {parity: 3, conclusion: 4},
  reviewer: 'Teacher A', rationale: 'The parity argument establishes the required divisibility.'
});
```

`assessProof` returns criterion descriptions, exact text spans with source offsets, writing prompts, and a review checklist. Its prompts are general guidance; they are not detected mathematical errors. It never awards points for terminology, answer length, or matching a model solution. Each criterion's evidence remains empty until a reviewer supplies it. Blank submissions are flagged for completion without pretending that an evaluator has marked them.

## Independent reviewer adapter

`runIndependentReview({question, answer, evaluators:[reviewA, reviewB]})` calls two distinct evaluator functions in parallel with isolated inputs. Each receives `{instructions,question,submission}`. Implement provider calls on a server; keep credentials out of the browser. This repository includes the adapter contract, validation, and adjudication logic, not an enabled paid model provider or an accuracy claim. Distinct functions do not guarantee statistically independent model errors.

Each function returns:

```js
{
  criterionScores: {parity: 3, conclusion: 4},
  rationale: 'Explanation of mathematical judgement',
  evidence: [{criterionId: 'parity', quote: 'Exact text from the submitted answer'}],
  gaps: []
}
```

Evidence must occur verbatim in the submitted answer, and criteria/points are validated. Two matching proposals still require human validation. Invalid output, timeouts or disagreement leave the answer unscored. Treat all model outputs as untrusted proposals. The adapter's instructions cannot guarantee prompt-injection resistance; final teacher moderation remains mandatory. The default HTTP API does not call external models or transmit answers to third parties.

## Sourced grading design

The [IMO General Regulations, section 7](https://www.imo-official.org/regulations/) describe problem-specific marking schemes, independent assessment and coordination to resolve disagreements. We adapt those workflow ideas through rubric validation, separate review proposals and recorded final decisions. This is an engineering adaptation, not the official IMO scoring system or an endorsement.

The [UKMT BMO1 2023 markers' report, pages 1–2](https://ukmt.org.uk/wp-content/uploads/2023/12/BMO1-2023-Markers-Report-.pdf) emphasizes a coherent strategy, complete justification, logical gaps and meaningful partial progress. We adapt that into the holistic review checklist. We do not transplant its particular partial-credit thresholds to CMI/ISI questions. Those exams need their own validated, problem-specific marking schemes. Both sources were checked on 3 November 2026.

See [the evaluation protocol](docs/EVALUATION.md) before making any accuracy claim.
