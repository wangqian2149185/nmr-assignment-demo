---
name: nmr-assignment
description: Short controller skill for staged protein NMR peak-list assignment.
---

# NMR Assignment Controller

Assign conservatively. Never force a peak or residue when evidence is weak, contradictory, or ambiguous.

Use this staged workflow:

1. `stage_1_column_mapping.md`: parse inputs and map columns to NMR dimensions.
2. `stage_2_anchor_selection.md`: group matching HSQC-centered peaks into observed pseudo-residue terms.
3. `stage_3_residue_map.md`: connect pseudo residues into fragments with `i-1` Cx evidence.
4. `stage_4_apply_peak_labels.md`: apply accepted fragment placements to all peak lists.
5. `stage_5_refine_ambiguous.md`: validate connected fragments against the uploaded protein sequence.
6. `stage_6_validation.md`: validate output consistency.

Runtime rule: only load the sub-skill files needed for the current stage.

Default two-stage tolerances:

- Candidate search: `H = 0.20 ppm`, `C = 0.50 ppm`, `N = 0.80 ppm`.
- Confirmation: `H = 0.04 ppm`, `C = 0.25 ppm`, `N = 0.30 ppm`.

The app should group pseudo-residue terms and build connected fragments programmatically. The LLM should receive compact fragments only, judge whether each fragment fits a contiguous part of the uploaded protein sequence, report mismatched pseudo residues or rejected links, and let the app apply accepted placements back to peak lists.
