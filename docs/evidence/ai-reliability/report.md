# AI reliability verification

Scripted provider responses exercise the same advisory boundary as the local model.

| Boundary case | Observed outcome | Release decision |
| --- | --- | --- |
| valid structured advice | accepted | BLOCK |
| attempted verdict override | invalid-advice | BLOCK |
| shell action | invalid-advice | BLOCK |
| invented check | invalid-advice | BLOCK |
| passing check prioritized | invalid-advice | BLOCK |
| missing action | invalid-advice | BLOCK |
| malformed advice | invalid-advice | BLOCK |
| provider outage | model-unavailable | BLOCK |
| provider hangs | model-timeout | BLOCK |
| provider outage on healthy release | model-unavailable | SHIP |
| provider outage during locator review | model-unavailable | REVIEW |

## Triage benchmark

Rules chose an acceptable first check in 7/8 synthetic incidents.
llama3.2:latest chose an acceptable first check in 17/24 trials, with 1 fallbacks.
The model chose the same accepted priority across all three samples in 7/8 incidents. Observed p95 advisory latency was 592 ms.
These are paired lab results. Three samples per incident share the same evidence.

| Incident | Acceptable first check | Rules first | Model first (seeds 0, 1, 2) |
| --- | --- | --- | --- |
| payment failure with browser symptom | api-contract | api-contract | model-timeout, api-contract, api-contract |
| assistant regression with locator drift | assistant-eval | assistant-eval | assistant-eval, assistant-eval, assistant-eval |
| missing browser evidence | browser-desktop | browser-desktop | browser-desktop, browser-desktop, browser-desktop |
| load runner unavailable with locator drift | load-smoke | load-smoke | browser-mobile, browser-mobile, browser-mobile |
| mobile-only regression | browser-mobile | browser-mobile | browser-mobile, browser-mobile, browser-mobile |
| checkout contract unavailable | api-contract | api-contract | api-contract, api-contract, api-contract |
| selector drift only | browser-desktop, browser-mobile | browser-desktop | browser-desktop, browser-desktop, browser-desktop |
| browser symptom arrives before service failure | api-contract | browser-desktop | browser-desktop, browser-desktop, browser-desktop |
