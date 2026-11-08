# Fault injection results

| Scenario | Expected | Actual | Findings |
| --- | --- | --- | --- |
| [healthy](healthy/release.md) | SHIP | SHIP | All checks passed |
| [selector-drift](selector-drift/release.md) | REVIEW | REVIEW | browser-desktop, browser-mobile |
| [checkout-regression](checkout-regression/release.md) | BLOCK | BLOCK | api-contract, browser-desktop, browser-mobile, load-smoke |
| [drift-with-regression](drift-with-regression/release.md) | BLOCK | BLOCK | api-contract, browser-desktop, browser-mobile, load-smoke |
| [eval-regression](eval-regression/release.md) | BLOCK | BLOCK | assistant-eval |
| [duplicate-charge](duplicate-charge/release.md) | BLOCK | BLOCK | api-contract |
| [privacy-leak](privacy-leak/release.md) | BLOCK | BLOCK | api-contract |
