# Stage 4: Apply Peak Labels

Goal: apply a compact `residue_assignment_map` to uploaded peak-list rows.

This stage is first performed deterministically in `server.js`. The LLM may review and correct selected medium/low-confidence rows after programmatic fill.

Rules:

- Preserve every original peak row and peak ID.
- For HSQC, write labels like `E31N-HN`.
- For HNCACB/HNCA/HN(CO)CACB/CBCA(CO)NH, write labels like `E31N-CA-HN` or `E31N-CB-HN`.
- `assigned_anchor_residue` is the amide residue observed in HSQC.
- `assigned_source_residue` is the residue that contributes the carbon/proton source.
- For intra peaks, source residue equals anchor residue.
- For `i-1` peaks, source residue is the previous sequence residue.
- Use `assigned_relation` values: `intra`, `sequential_i_minus_1`, `intra_spin_system`, or `ambiguous`.
- Use tight tolerances to raise confidence; otherwise keep confidence `medium` or `low`.

Do not ask the LLM to rewrite all peak rows unless programmatic fill failed.
