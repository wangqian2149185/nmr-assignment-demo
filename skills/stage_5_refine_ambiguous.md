# Stage 5: Validate Connected Fragments

Goal: validate compact connected pseudo-residue fragments against the uploaded protein sequence.

Rules:

- Do not perform broad numeric matching on full peak tables.
- Judge whether each fragment can be a contiguous segment of the uploaded protein sequence.
- Use HN, N, Hx, Cx, Gly N range, Gly no CB, Ser/Thr high CB, Ala low CB, and Proline amide gaps.
- Return accepted residue labels only for pseudo residues that fit the sequence and chemical shifts.
- Report mismatched pseudo residues and rejected links when a connection should be broken.
- If evidence remains weak or contradictory, keep the fragment low-confidence or omit placement.
- Prefer short notes only when they explain a useful warning.
- Do not output prose or markdown.

Return compact JSON only:

```json
{
  "placements": [
    {
      "fragment_id": "F001",
      "start_index": 31,
      "confidence": "medium",
      "residue_labels_by_temp_id": {
        "R001": "E31",
        "R002": "D32"
      },
      "mismatches": [
        { "temp_id": "R003", "reason": "CB fits Thr not Ala" }
      ]
    }
  ],
  "rejected_links": [
    { "from_temp_id": "R002", "to_temp_id": "R003", "reason": "i-1 Cx mismatch" }
  ],
  "notes": ""
}
```
