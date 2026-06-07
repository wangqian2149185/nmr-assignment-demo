---
name: nmr-assignment
description: Short controller skill for staged protein NMR peak-list assignment.
---

# NMR Assignment Controller

Assign conservatively. Never force a peak or residue when evidence is weak, contradictory, or ambiguous.

Use this staged workflow:

1. `stage_1_column_mapping.md`: parse inputs and map columns to NMR dimensions.
2. `stage_2_anchor_selection.md`: group matching HSQC-centered peaks into observed pseudo-residue terms.
3. `stage_3_residue_map.md`: collect candidate `i-1` Cx evidence without forcing final connections.
4. `stage_4_apply_peak_labels.md`: apply accepted fragment placements to all peak lists.
5. `stage_5_refine_ambiguous.md`: let the LLM reason over observed terms, establish links, infer residue types, handle possible HN/N merges, and verify sequence placement.
6. `stage_6_validation.md`: validate output consistency.

Runtime rule: only load the sub-skill files needed for the current stage.

Default two-stage tolerances:

- Candidate search: `H = 0.20 ppm`, `C = 0.50 ppm`, `N = 0.80 ppm`.
- Confirmation: `H = 0.04 ppm`, `C = 0.25 ppm`, `N = 0.30 ppm`.

The app should group pseudo-residue terms programmatically by HN/N tolerance. The LLM should receive compact observed terms plus candidate links, then reason about i/i-1 Cx evidence, possible HN/N merges or splits, missing CA/CB evidence, residue types, and sequence placement. The app applies accepted placements back to peak lists.
