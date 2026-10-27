"""Split the approved plan file into verbatim baseline/revision files.

Refuses to overwrite existing files. Prints SHA-256 of each output so the
evidence log can record exactly what was preserved.
"""
import hashlib, pathlib, sys

plan = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
out = pathlib.Path(sys.argv[2])

A_MARK = "# PART A: v1 audit (preserved unchanged; superseded where C-01…C-10 say so)\n"
B_MARK = "# PART B: Baseline v0 (original draft, preserved unmodified)\n"
a, b = plan.index(A_MARK), plan.index(B_MARK)

parts = {
    "revisions/v1.1-corrections.md": plan[:a],
    "baseline/v1-audit.md": plan[a + len(A_MARK):b],
    "baseline/v0-plan.md": plan[b + len(B_MARK):],
}
for rel, text in parts.items():
    p = out / rel
    if p.exists():
        sys.exit(f"refusing to overwrite {p}")
    p.write_text(text.strip("\n -") + "\n", encoding="utf-8")
    print(rel, len(text), hashlib.sha256(p.read_bytes()).hexdigest())
print("plan sha256", hashlib.sha256(plan.encode("utf-8")).hexdigest())
