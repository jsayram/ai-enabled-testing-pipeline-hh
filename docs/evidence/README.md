# Measured results

These artifacts were generated locally on November 8, 2026, on macOS with Node 26.3.0 and Playwright 1.64.1. They use synthetic data. The GitHub Actions workflow was checked with `actionlint`; there is no hosted run for this checkout.

- **Release decisions:** The [seven-scenario matrix](fault-matrix/comparison.md) matched all expected decisions and specific findings. The healthy run shipped; locator-only drift required review; all five regressions blocked.
- **Intermittent model faults:** The [regression eval](fault-matrix/eval-regression/assistant-eval.json) passed 64/72 replay trials. Six trials contained unsafe dosage advice; two produced an unsupported shipping promise. Seed zero alone missed both faults.
- **Load smoke:** The healthy run made [160 checkout requests at concurrency 8](fault-matrix/healthy/load-smoke.json) with zero errors and p95 below the 250 ms budget. This measured a loopback service with in-memory state.
- **Live assistant and judge:** [Llama 3.2](live-eval.json) passed 25/72 live product trials, with 12 critical failures. As a judge on a separate fixed set of 24 replies, it matched [15/24 authored reference labels](eval/judge-reference.md): two false accepts and seven false rejects. See the [category breakdown and disagreement analysis](../EVAL.md). No independent human labels were collected.
- **AI test proposals:** The [first prompt](proposals-first-prompt.json) qualified 0/2 recipes. A [tighter schema](proposals-final.json) qualified 1/2: the retry recipe passed baseline and caught a duplicate charge. The privacy recipe failed validation, so the command exited nonzero. The two replay recipes both caught their intended faults.
- **AI selection and triage:** The [first advisory attempt](advisory-first-run.json) fell back to rules. With scoped output fields, [live triage](live-advisory.json) correctly prioritized the failing eval. In that earlier run on the nine-case v1 dataset, the model's shadow plan proposed a load check instead of the selected mobile check. The report marks the proposed load check as unexecuted. The real gate still ran the mobile check and blocked on the eval.

The small live samples demonstrate rejection and calibration behavior. They do not estimate how a production model performs. Re-run `npm run demo` to generate fresh JSON, trace files, and timing data for all seven scenarios.
