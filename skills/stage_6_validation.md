# Stage 6: Validation

Goal: check consistency before presenting or downloading assignments.

Validation checklist:

1. Required output fields exist.
2. Peak IDs are unchanged.
3. Residue labels exist in the sequence.
4. Proline is not assigned a normal backbone amide HSQC anchor.
5. Sequential `i-1` assignments do not point outside the sequence.
6. Atom names are plausible for the residue.
7. Glycine has no CB assignment unless explicitly justified as non-standard.
8. Duplicate/overlapping peaks are either intentionally degenerate or marked ambiguous.
9. Confidence reflects evidence strength.

Confidence:

- `high`: unique match across relevant experiments and tight tolerance confirmation.
- `medium`: plausible but missing confirmation or minor ambiguity.
- `low`: weak evidence, missing companion peak, overlap, or loose-window-only match.
- `ambiguous`: multiple plausible assignments remain.
