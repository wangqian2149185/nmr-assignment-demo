# Stage 1: Column Mapping

Goal: interpret uploaded peak-list and sequence tables before assignment.

Rules:

- Preserve original rows and peak IDs. Never invent peak IDs.
- Identify NMR dimensions from headers or user mapping: `HN`, `Hx`, `N`, `CA`, `CB`, `Cx`, `CO`, `intensity`, `sign`.
- `Hx` means a generic proton dimension. `Cx` means a generic carbon dimension.
- For Bruker/Sparky-style lists, common columns are:
  - `Assignment`
  - `w1`, `w2`, `w3`
  - `DataHeight`, `Data Height`
- For `1H-15N HSQC`, map dimensions as `N` and `HN`.
- For `HNCACB` and `HN(CO)CACB`/`CBCA(CO)NH`, map dimensions as `N`, `Cx`, and `HN`.
- Blank/header-like repeated rows should be ignored.
- Sequence may be FASTA, one-letter text, or a table with index plus one-letter, three-letter, or combined labels such as `E31`.

Output for later stages should use normalized rows with:

```text
peak_id, HN, Hx, N, C, raw
```
