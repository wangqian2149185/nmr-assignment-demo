# Stage 5: Refine Ambiguous Rows

Goal: refine only rows that are blank, low-confidence, or ambiguous after applying the residue map.

Rules:

- Do not revisit high-confidence rows.
- Use the existing `residue_assignment_map` as the primary context.
- Keep `experiment_key` and `peak_id` exactly as provided.
- If evidence remains weak or contradictory, keep fields blank and confidence `low` or `ambiguous`.
- Prefer short notes only when they explain a useful warning.
- Do not output prose or markdown.

Return compact JSON only:

```json
{
  "assignments": [
    {
      "experiment_key": "HNCACB",
      "peak_id": "original peak id",
      "assigned_label": "E31N-CA-HN",
      "assigned_anchor_residue": "E31",
      "assigned_source_residue": "E31",
      "assigned_source_atoms": "N,CA,HN",
      "assigned_relation": "intra",
      "confidence": "medium",
      "notes": ""
    }
  ]
}
```
