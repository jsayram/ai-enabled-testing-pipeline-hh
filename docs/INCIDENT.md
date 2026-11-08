# Incident exercise: locator drift with a broken payment

**Decision:** Block. In the injected scenario, an approved payment returned HTTP 402 instead of creating a paid order. A simultaneous test ID rename made a selector failure plausible. A reviewer who looked only at the locator could have misdiagnosed the customer impact.

**Evidence:** The API contract expected 201 and saw 402. Both browser profiles found one semantically equivalent button with the same action binding, clicked it, and observed the same failed payment response. The receipt assertions stayed enabled. The load smoke also saw checkout errors. The decision report and Playwright traces record the failure.

**Response:** Checkout reproduces the fault via the API, restores approved payment behavior, and reruns the gate. If the rename was intentional, Checkout reviews the locator update separately with the original behavior checks intact. Platform confirms that the combined fault remains blocked; a clean rerun must have all required evidence. In an actual rollout, the equivalent symptoms would call for pausing promotion, then checking payment acceptance and duplicate charges before rollback or retry.

**Prevention:** Keep the API invariant and the paired drift-plus-regression fixture. Track checkout approval rate, duplicate-charge attempts, and the percentage of locator recoveries that turn out to be product failures. This was a local exercise; there was no production outage or real customer impact.
