# Release decision: REVIEW

Scenario: `selector-drift`

| Check | Owner | Status | Evidence | Time |
| --- | --- | --- | --- | ---: |
| api-contract | Checkout | pass | Payment, retries, account isolation and support request contract passed | 29 ms |
| browser-desktop | Checkout | review | Locator recovery preserved assertions: checkout-submit → scoped Place order (same action binding) | 1122 ms |
| assistant-eval | Support | pass | 72/72 replay trials passed; 0 critical failures | 2 ms |
| browser-mobile | Checkout | review | Locator recovery preserved assertions: checkout-submit → scoped Place order (same action binding) | 1108 ms |
| load-smoke | Platform | pass | 160 requests / 0 errors; p95 4.4 ms (budget 250 ms); 2883 req/s | 56 ms |

- browser-desktop: unresolved evidence requires owner review
- browser-mobile: unresolved evidence requires owner review

Advisory mode: replay. Advisory output cannot change this decision.

- browser-desktop: Ask Checkout to review the locator replacement against the unchanged behavior assertions.
- browser-mobile: Ask Checkout to review the locator replacement against the unchanged behavior assertions.
