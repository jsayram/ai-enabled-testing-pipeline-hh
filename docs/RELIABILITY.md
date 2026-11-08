# How the lab verifies AI-assisted testing

The lab tests three things separately. Traditional checks detect storefront regressions. The assistant eval checks the product model's behavior. The reliability suite checks whether the AI testing layer gives useful advice and what happens when it is wrong or unavailable.

| AI use | How the lab checks it | What controls the outcome |
| --- | --- | --- |
| Test drafting | The recipe must pass a healthy checkout and catch its intended injected fault using the harness's assertions | A maintainer reviews the qualified recipe |
| Optional test selection | A shadow comparison records omitted findings and proposed checks with no observed evidence | Required checks and change impact rules determine which tests run |
| Failure triage | Repeated model samples and deterministic rules see the same labeled incident cases | The reviewer chooses the investigation order |
| Support assistant and judge | Repeated golden cases check behavior. A separate rubric benchmark counts false accepts and false rejects | Deterministic product checks and a separate model qualification decision |
| Release reporting | A verifier recomputes the plan and verdict and matches primary artifact hashes | Versioned release rules and recorded check outcomes |

See [test recipes](../src/quality/proposals.ts), [product and judge results](EVAL.md), and [architecture](ARCHITECTURE.md).

## Run the verification demo

```sh
npm run demo
npm run verify:ai -- --replay
OLLAMA_AGENT_MODEL=llama3.2:latest npm run verify:ai
```

The full demo runs seven storefront scenarios, checks each expected verdict, and verifies the generated release reports. Its comparison page links to the AI boundary checks. The replay verification command works without Ollama. The optional live command benchmarks the same triage adapter used by the gate.

The advisory layer receives check IDs, statuses, and allowed actions. The replay suite places a synthetic prompt injection in check summaries and verifies that it stays outside the provider input. It also supplies malformed output, a forged release verdict, a shell action, a provider error, and a hung response. Each advisory call has a five-second deadline and falls back to rules on invalid output or provider failure. The injected hang verifies that cancellation reaches the provider. The release gate derives its verdict from the deterministic check plan and outcomes.

To verify a saved release bundle, point the verifier at a current run. In CI, the expected revision comes from the runner.

```sh
npm run gate -- --out artifacts/reliability-gate
npm run verify:release -- --dir artifacts/reliability-gate
```

The verifier replays the current versioned policy and checks SHA-256 digests for the primary Playwright, assistant-eval, and load evidence that exists in the bundle. It checks the expected commit when supplied. These checks establish consistency within the bundle. Authenticity requires an independently trusted runner or signed provenance. Earlier schema 1 reports remain historical snapshots.

## What the model added in the measured run

All 11 scripted advisory boundary cases passed. The full gate also returned `BLOCK` on the assistant regression when its configured model was unavailable. The report verifier reproduced that verdict. [Provider outage evidence](evidence/ai-reliability/provider-outage.md)

The rules chose an acceptable first check in 7 of 8 synthetic incidents. Repeating those same incidents with three seeds, Llama 3.2 chose an acceptable first check in 17 of 24 trials, with one timeout. The model repeated its choice across all three trials in 7 of 8 incidents. It consistently prioritized locator drift over a load runner error in one case. It also followed the first browser symptom in another case where the contract failure was the better starting point. The measured run supports keeping this model's triage advisory. [Paired incident results](evidence/ai-reliability/report.md) · [Raw benchmark data](evidence/ai-reliability/report.json)

The test drafting lane shows a different use of AI. One generated recipe passed the healthy case and caught a duplicate charge. A second recipe failed validation. This shows that the harness can qualify a concrete draft. Measuring incremental value requires holding out new faults and comparing which ones the human-authored suite and qualified drafts catch. [Recipe evidence](evidence/proposals-final.json)

## Applying the same approach to a real system

1. **Set the baseline.** Run the existing checks at full coverage and record escaped defects, false blocks, and time to the first actionable finding. Pick one task for AI to improve, such as drafting boundary tests or triaging failures.
2. **Compare on representative cases.** Keep a versioned, independently reviewed holdout of incidents, edge cases, and attacks. Compare paired outcomes against the deterministic baseline. Measure faults caught, false accepts, false rejects, fallbacks, latency, and per-case stability. Stratify by impact and include uncertainty when reporting rates.
3. **Roll out in shadow mode.** Run real tests independently of suggestions. Review missed findings and gate disagreements. Only promote an advisory capability after it demonstrates a measurable improvement and meets the team's error and latency budgets. Keep an owner, a rollback path, and a deterministic fallback.
4. **Revalidate changes and monitor production.** Record the model digest, prompt, dataset, rubric, and policy version. Rerun the holdout on changes to any of them. Track fallback rates, missed failures, latency, and incident outcomes after rollout. Feed new failures into future evals and keep a fresh holdout for subsequent comparisons.

The lab follows risk-based evaluation and predeployment testing guidance, with model input isolation, constrained outputs, and limited authority. The checked-in data is synthetic and the live triage comparison covers eight incidents. [NIST Generative AI risk management profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) · [OWASP guidance on handling model outputs](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/) · [OWASP guidance on excessive agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
