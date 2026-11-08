# Five-minute project demo

Follow the release gate through a passing run, a locator change that needs review, and regressions that block release.

## Browser replay

Pick a scenario to recompute its release verdict in your browser. Start on **Healthy release**, then remove the assistant eval result to see the policy block on missing evidence. Select **AI provider outage** to inspect the recorded fallback and expand the benchmark to compare model and rules decisions by incident. [Open the live demo](https://tidal-linden-4dnd.here.now/)

The browser uses the shared release policy and recorded test results. Use the command-line demo below to execute fresh API, Playwright, and assistant checks. To build and preview the browser replay locally:

```sh
npm run build:web-demo
python3 -m http.server 4174 --bind 127.0.0.1 --directory dist/demo
```

Open [localhost:4174](http://localhost:4174/). To refresh the recorded scenarios, pass `--matrix <demo-output-directory>` and `--outage <unavailable-model-run-directory>` to `npm run build:web-demo --`. The exporter verifies each source report before writing the public snapshot.

## Run the full test pipeline

1. **Show the decision.** Run `npm run demo`, then open the printed comparison file. Start with `healthy/release.md`: point to the owners, required evidence, and release status. The API checks concurrent retries and account isolation; the browser checks what a shopper sees after submitting the payment.
2. **Challenge self-healing.** Open `selector-drift/release.md`, then `drift-with-regression/release.md`. In both cases the old locator is absent. One verified replacement still pays and shows a receipt, so the result is review. The other hits a failed payment, so the result is block. The Playwright trace records the failed payment.
3. **Test the AI product.** Open `eval-regression/assistant-eval.json`. Seed zero is clean; other seeds reveal a false shipping promise and unsafe advice. Then show the [live Llama and judge results](EVAL.md). The replay baseline passes; the live candidate and judge did not qualify.
4. **Verify the AI layer.** Open the AI reliability report linked from the comparison file. The suite injects a forged verdict, malformed output, and provider failures. Compare the rules and the local model on the same incidents. [Reliability report](RELIABILITY.md)
5. **Qualify an AI-drafted test.** Show [test proposals](../src/quality/proposals.ts): a model picks a sequence of allowed actions, the harness owns the assertions, and a candidate is useful only if it catches the intended fault. Show the [release policy](../src/quality/policy.ts): all required checks must have exactly one valid result.
6. **Review the rollout decision.** Start with shadow metrics. Enable optional test skipping only after it is shown to preserve fault detection. Keep locator repair in review. Require independent live model evidence before product model promotion.

If browser setup is unavailable, use the [checked-in results](evidence/README.md) and `npm test`. If Ollama is unavailable, the demo remains fully reproducible in replay mode.

The local storefront is the application under test. [Storefront screenshot](images/demo-storefront.png)
