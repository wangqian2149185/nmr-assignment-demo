# Stage 5: Validate Connected Fragments

Goal: validate compact connected pseudo-residue fragments against the uploaded protein sequence.

Rules:

- Do not perform broad numeric matching on full peak tables.
- Judge whether each fragment can be a contiguous segment of the uploaded protein sequence.
- Use HN, N, Hx, Cx, Gly N range, Gly no CB, Ser/Thr high CB, Ala low CB, and Proline amide gaps.
- Return accepted residue labels only for pseudo residues that fit the sequence and chemical shifts.
- Report mismatched pseudo residues and rejected links when a connection should be broken.
- If evidence remains weak or contradictory, keep the fragment low-confidence or omit placement.
- Do not output notes, prose, markdown, or JSON.

Return plain-text line protocol only:

```text
F001|31|m|R001:E31,R002:D32
!R002>R003
```

Use confidence letters only: `h`, `m`, or `l`. If nothing can be placed or rejected confidently, return `NONE`.
