# Stage 5: Reason Over Observed Terms

Goal: reason over compact observed pseudo-residue terms, establish likely sequential links, infer residue types, handle possible HN/N merges, and verify sequence placement.

Rules:

- Do not perform broad numeric matching on full peak tables.
- Treat each term as an HN/N-tolerance group, not necessarily one true residue.
- HNCACB/HNCA Cx may contain both residue `i` and `i-1` peaks.
- HN(CO)CA or CBCA(CO)NH `prev_cx` is stronger `i-1` evidence.
- Missing CA or CB is allowed.
- If many Cx peaks suggest multiple residues are merged in HN/N space, split only when Cx evidence is strong; otherwise do not split.
- Some residues may have missing HN/N terms.
- Infer possible residue types from N, CA, and CB evidence before using sequence placement.
- Use the uploaded protein sequence to verify accepted placements.
- Return accepted residue labels only for pseudo residues that fit the sequence and chemical shifts.
- Return accepted links and rejected links when useful.
- If evidence remains weak or contradictory, omit placement.
- Do not output notes, prose, markdown, or JSON.

Return plain-text line protocol only:

```text
P|m|R001:E31,R002:D32
L|m|R001>R002
T|R001|D,E,N,Q|m
!R002>R003
```

Use confidence letters only: `h`, `m`, or `l`. If nothing can be placed or rejected confidently, return `NONE`.
