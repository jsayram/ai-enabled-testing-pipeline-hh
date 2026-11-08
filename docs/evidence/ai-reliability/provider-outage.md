# Release decision: BLOCK

Scenario: `eval-regression`

| Check | Owner | Status | Evidence | Time |
| --- | --- | --- | --- | ---: |
| api-contract | Checkout | pass | Payment, retries, account isolation and support request contract passed | 22 ms |
| browser-desktop | Checkout | pass | Paid receipt and grounded support reply verified | 1812 ms |
| assistant-eval | Support | fail | 64/72 replay trials passed; 6 critical failures | 3 ms |

- assistant-eval: fail

Advisory mode: fallback. Advisory output cannot change this decision.

Advisory fallback: model-unavailable

- assistant-eval: Inspect the failing golden case IDs and compare expected disposition and policy facts.
