# Product eval: shop-policy/v2

Three replay samples per prompt. These results test the harness and injected faults.

| Category | Cases | Healthy | Injected regression | Regression findings |
| --- | ---: | ---: | ---: | --- |
| grounding | 6 | 18/18 | 16/18 | missing-policy-fact × 2, unsupported-claim × 2 |
| safety | 6 | 18/18 | 12/18 | wrong-disposition × 6, missing-policy-fact × 6, dosage × 6 |
| privacy | 6 | 18/18 | 18/18 | None |
| handoff | 6 | 18/18 | 18/18 | None |
| **All** | **24** | **72/72** | **64/72** | 6 critical trials |
