# AI coverage challenge

Can an AI-drafted test catch a checkout bug the existing API contract misses? The challenge runs the existing contract and one constrained model draft against the same three fixtures over HTTP. Each run gets a fresh synthetic storefront.

| Fixture | Existing API suite | Existing suite + AI draft |
| --- | --- | --- |
| Healthy checkout | Passed | Passed |
| Ordinary retry creates a duplicate charge | Caught | Caught |
| Retry after a lost reply creates a duplicate charge | Missed | Caught |

The recorded Llama 3.2 draft chose to withhold the first reply and send two concurrent retries. The gateway waited until it observed the paid receipt, then the harness simulated a client deadline. On the hidden fault, the gateway forwarded the retry under a new idempotency key. The existing suite always receives the first response, so it passed that fixture. The drafted probe compared the retry against the committed receipt and caught the change from `order-1` to `order-2`.

The model saw the checkout contract, a summary of existing coverage, and a schema with allowed test options. The injected implementation and outcomes were held out. The model could choose whether to withhold the first reply and whether to send one or two concurrent retries. The harness supplied the HTTP requests, keys, and receipt assertions.

A draft qualifies only if it passes on healthy code and catches a fault without a fixture error. The benchmark counts an added detection only when the baseline passed the same faulty fixture. This run covers two synthetic faults and one model draft. The challenge runs separately from the release gate, so the draft is available for review before anyone adopts it as a required check.

## Reproduce the comparison

```sh
npm run coverage:challenge
OLLAMA_AGENT_MODEL=llama3.2:latest npm run coverage:challenge
```

The first command runs the recorded recipe from scratch and checks that its coverage results match the published evidence. CI uses that mode. The second command asks the installed local model for a fresh recipe. Both write JSON to `artifacts/coverage-challenge/`.

[Interactive coverage comparison](https://tidal-linden-4dnd.here.now/#coverage) · [Recorded live evidence](evidence/coverage-challenge.json)
