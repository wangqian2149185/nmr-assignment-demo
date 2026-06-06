---
name: nmr-assignment
description: Short controller skill for staged protein NMR peak-list assignment.
---

# NMR Assignment Controller

Assign conservatively. Never force a peak or residue when evidence is weak, contradictory, or ambiguous.

Use this staged workflow:

1. `stage_1_column_mapping.md`: parse inputs and map columns to NMR dimensions.
2. `stage_2_anchor_selection.md`: choose HSQC amide anchors, using auto or user seed mode.
3. `stage_3_residue_map.md`: build the compact `residue_assignment_map`.
4. `stage_4_apply_peak_labels.md`: apply the map to all peak lists.
5. `stage_5_refine_ambiguous.md`: refine only low-confidence or blank rows.
6. `stage_6_validation.md`: validate output consistency.

Runtime rule: only load the sub-skill files needed for the current stage.

Default two-stage tolerances:

- Candidate search: `H = 0.20 ppm`, `C = 0.50 ppm`, `N = 0.80 ppm`.
- Confirmation: `H = 0.04 ppm`, `C = 0.25 ppm`, `N = 0.30 ppm`.

The app should first ask the LLM for a compact `residue_assignment_map`, then fill peak-list rows programmatically. Only ambiguous or low-confidence rows should be sent to a small refinement prompt.
