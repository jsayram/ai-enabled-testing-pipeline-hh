# Release decision: BLOCK

Scenario: `duplicate-charge`

| Check | Owner | Status | Evidence | Time |
| --- | --- | --- | --- | ---: |
| api-contract | Checkout | fail | Idempotent retries must return the original order + actual - expected    { +   id: 'order-2', -   id: 'order-1',     status: 'paid',     totalCents: 2400   }  | 19 ms |
| browser-desktop | Checkout | pass | Paid receipt and grounded support reply verified | 1054 ms |
| assistant-eval | Support | pass | 72/72 replay trials passed; 0 critical failures | 2 ms |
| browser-mobile | Checkout | pass | Paid receipt and grounded support reply verified | 1053 ms |
| load-smoke | Platform | pass | 160 requests / 0 errors; p95 5.6 ms (budget 250 ms); 2704 req/s | 60 ms |

- api-contract: fail

Advisory mode: replay. Advisory output cannot change this decision.

- api-contract: Inspect the first failed API invariant and reproduce it with the contract suite.
