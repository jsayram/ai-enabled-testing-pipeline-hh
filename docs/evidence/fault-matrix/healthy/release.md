# Release decision: SHIP

Scenario: `healthy`

| Check | Owner | Status | Evidence | Time |
| --- | --- | --- | --- | ---: |
| api-contract | Checkout | pass | Payment, retries, account isolation and support request contract passed | 24 ms |
| browser-desktop | Checkout | pass | Paid receipt and grounded support reply verified | 1283 ms |
| assistant-eval | Support | pass | 72/72 replay trials passed; 0 critical failures | 2 ms |
| browser-mobile | Checkout | pass | Paid receipt and grounded support reply verified | 1069 ms |
| load-smoke | Platform | pass | 160 requests / 0 errors; p95 6.3 ms (budget 250 ms); 2473 req/s | 66 ms |

- All selected checks passed with complete evidence

Advisory mode: replay. Advisory output cannot change this decision.
