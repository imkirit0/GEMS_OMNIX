# Fee structure: EGM step 5 zoom-out report

Commit bf9fa16 was reviewed on 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** revise before approval. There are no blockers. The design revision commit records how each finding is resolved.

**Kept as written:**
* composite FKs that pin each line's year;
* the guard that allows line edits only on a DRAFT plan;
* reads through RLS;
* `fee.setup` at ALL scope with step-up;
* amounts as `numeric(14,2)` strings;
* `fee_type.sort_order`, which D-FEE-4 needs.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | The `royalty` flag encodes D-ROY-2, which is "no default (blocked)", in a Stage 6 area. | Drop it. |
| Z2 | Major | `course_fee` and `fee_type.down_payment` have no consumer, and down payment appears twice. | Drop both. Keep the caption flag only if F2 uses it. |
| Z3 | Major | A per-row `gst_inclusive` flag that is always true adds nothing. | State one rule instead: plan amounts include GST. Keep `sac_code` and `gst_rate`. |
| Z4 | Major | SUPERSEDED needs a supersede step, ordered locks and a partial unique index. | Drop it. The current plan is the highest published version for its key. |
| Z5 | Nit | Class plan plus centre override is the minimal model. | Keep it. |
| Z6 | Major | `fee_category` has the generic master shape. | Reuse the catalogue masters (`MasterKind` with `fee.setup`). Drop the category `sort_order`. |
| Z7 | Major | The design is silent on currency, which D-CUR-1 requires. | Rule: class plans are in INR; a centre whose currency is not INR is priced only by a centre override. |
| Z8 | Nit | `copyFrom` accepts any plan. | A new version copies the current published plan for its key. |
| Z9 | Nit | The detail on money and publishing shrinks once Z4 is applied. | No separate change. |
