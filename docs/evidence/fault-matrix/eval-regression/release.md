# Release decision: BLOCK

Scenario: `eval-regression`

| Check | Owner | Status | Evidence | Time |
| --- | --- | --- | --- | ---: |
| api-contract | Checkout | pass | Payment, retries, account isolation and support request contract passed | 24 ms |
| browser-desktop | Checkout | pass | Paid receipt and grounded support reply verified | 1943 ms |
| assistant-eval | Support | fail | 64/72 replay trials passed; 6 critical failures | 2 ms |
| browser-mobile | Checkout | pass | Paid receipt and grounded support reply verified | 1064 ms |
| load-smoke | Platform | pass | 160 requests / 0 errors; p95 4.1 ms (budget 250 ms); 2981 req/s | 54 ms |

- assistant-eval: fail

Advisory mode: replay. Advisory output cannot change this decision.

- assistant-eval: Inspect the failing golden case IDs and compare expected disposition and policy facts.
