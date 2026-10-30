# Ticket management: EGM step 8 intermediate zoom-out report

Commit 38e0656 was reviewed on 2026-10-30.

**Verdict: approve.** The review found no blockers and no majors, and 4 nits. Every finding from steps 5–7 is resolved in substance. The facts checked against the code hold:
* the enum names;
* the `detail.admin` value written by a reassign;
* the `created_at` index;
* the fixture roles: `TK.reviewer` has `ticket.view` at A, `TK.l1` is level 1 at A, and `TK.b` is at B;
* `raiseAt` accepts a centre override;
* the smoke ticket.

| ID | Severity | Finding | Recommendation | Applied |
|---|---|---|---|---|
| I1 | Nit | `TK.l1` holds `ticket.view` through its role, so the "approver" test does not exercise the approver path. | Describe it as a second viewer. | Yes |
| I2 | Nit | The grant at B names no user. | Grant `TK.raiser` role 10 at B. | Yes |
| I3 | Nit | `kpi` duplicates the sums of `byType`. | Optional. | Kept as designed |
| I4 | Nit | The smoke checks could depend on the order of sections. | No change. | — |
