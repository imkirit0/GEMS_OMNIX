# GEMS OMNIX audit pack (v1.1)

This pack is the requirements and architecture baseline for rebuilding G-TEC's GEMS ERP. It contains **no application code**.

## Layout
| Path | What | Edit policy |
|---|---|---|
| `baseline/v0-plan.md` | Original plan/matrix (preserved verbatim) | **Never edit** |
| `baseline/v1-audit.md` | v1 audit (preserved verbatim) | **Never edit** |
| `revisions/v1.1-corrections.md` | Corrections C-01…C-12 against v0/v1 | New revisions go in new files |
| `01`…`12` | Consolidated v1.1 artifacts | Regenerate/revise per revision |
| `02-requirements-traceability-matrix.csv` | **Generated** from `data/matrix-*.tsv` by `tools/build_matrix.py` | Edit the TSVs, then re-run the tool |
| `data/matrix-*.tsv` | Source of the matrix (one row per legacy page/capability) | Edit here |
| `tools/` | `split_baselines.py` (one-off baseline extraction), `build_matrix.py` (matrix + T-DOC-001) | — |

## Evidence classes (used in every artifact)
| Class | Meaning |
|---|---|
| SRC | Confirmed from source documents (with page) |
| INF | Inferred from interface or data shape |
| REC | Reconstructed from an uninspected, broken or prose-only page or step |
| PRO | Proposed architecture; not a business rule |
| PMC | Pending manager confirmation |
| VER | Verified by an executable test with a logged run (**0 today**) |
| IMP | Implemented, unverified (**0 today**) |

## How to change something
1. Edit a TSV in `data/` (or add a new revision file).
2. Run `python -I tools/build_matrix.py .` from this folder. It must report `ERRORS (0)`.
3. Record the command and its output in `12-evidence-and-verification-log.md`.

## Artifacts
| # | Artifact |
|---|---|
| 01 | Executive architecture review |
| 02 | Traceability matrix (CSV) |
| 03 | Discrepancy report |
| 04 | Decision register |
| 05 | Workflow-to-test mapping |
| 06 | Security threat model |
| 07 | Financial invariants |
| 08 | Migration plan |
| 09 | Test strategy |
| 10 | Roadmap |
| 11 | POC specification |
| 12 | Evidence log |

Source PDFs: `../../GEMS ERP Rebuild Specification.pdf` (SPEC) and `../../GEMS Workflows for Manager Review.pdf` (WF).
