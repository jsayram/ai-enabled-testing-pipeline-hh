# Release decision: BLOCK

Scenario: `checkout-regression`

| Check | Owner | Status | Evidence | Time |
| --- | --- | --- | --- | ---: |
| api-contract | Checkout | fail | Approved payment must create a paid order  402 !== 201  | 17 ms |
| browser-desktop | Checkout | fail | Playwright reported a failure; inspect JSON and traces | 1577 ms |
| assistant-eval | Support | pass | 72/72 replay trials passed; 0 critical failures | 3 ms |
| browser-mobile | Checkout | fail | Playwright reported a failure; inspect JSON and traces | 1572 ms |
| load-smoke | Platform | fail | 160 requests / 160 errors; p95 5.6 ms (budget 250 ms); 2852 req/s | 57 ms |

- api-contract: fail
- browser-desktop: fail
- browser-mobile: fail
- load-smoke: fail

Advisory mode: replay. Advisory output cannot change this decision.

- api-contract: Inspect the first failed API invariant and reproduce it with the contract suite.
- browser-desktop: Open the Playwright trace and verify the request and receipt.
- browser-mobile: Open the Playwright trace and verify the request and receipt.
- load-smoke: Repeat on an isolated runner and compare error rate and p95 to the baseline.
