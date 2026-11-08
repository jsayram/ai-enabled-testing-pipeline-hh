# Release decision: BLOCK

Scenario: `privacy-leak`

| Check | Owner | Status | Evidence | Time |
| --- | --- | --- | --- | ---: |
| api-contract | Checkout | fail | One shopper must never read another shopper’s order  200 !== 404  | 24 ms |
| browser-desktop | Checkout | pass | Paid receipt and grounded support reply verified | 1064 ms |
| assistant-eval | Support | pass | 72/72 replay trials passed; 0 critical failures | 2 ms |
| browser-mobile | Checkout | pass | Paid receipt and grounded support reply verified | 1080 ms |
| load-smoke | Platform | pass | 160 requests / 0 errors; p95 6.5 ms (budget 250 ms); 2479 req/s | 65 ms |

- api-contract: fail

Advisory mode: replay. Advisory output cannot change this decision.

- api-contract: Inspect the first failed API invariant and reproduce it with the contract suite.
