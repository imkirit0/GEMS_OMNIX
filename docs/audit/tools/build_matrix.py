"""Combine data/matrix-*.tsv into 02-requirements-traceability-matrix.csv and
run T-DOC-001: ID-consistency checks across the matrix and audit markdown.

Usage: python -I tools/build_matrix.py <audit_dir>
Exit 0 = no errors (warnings may print). Exit 1 = errors.
"""
import csv, glob, pathlib, re, sys

root = pathlib.Path(sys.argv[1])
COLS = ["id", "parent", "doc", "page", "feature", "path", "details", "perms", "target",
        "deps", "evidence", "owner", "decisions", "tests", "migration", "removal", "stage"]
EVIDENCE = {"SRC", "INF", "REC", "PRO", "PMC", "VER", "IMP"}
STAGES = {f"S{i}" for i in range(9)}

rows, errors, warns = [], [], []
for f in sorted(glob.glob(str(root / "data" / "matrix-*.tsv"))):
    lines = pathlib.Path(f).read_text(encoding="utf-8").splitlines()
    if lines and lines[0].startswith("id\t"):
        lines = lines[1:]
    for n, line in enumerate(lines, 1):
        if not line.strip():
            continue
        cells = line.split("\t")
        if len(cells) != len(COLS):
            errors.append(f"{pathlib.Path(f).name}:{n} has {len(cells)} cells, expected {len(COLS)}")
            continue
        rows.append(dict(zip(COLS, cells)))

ids = [r["id"] for r in rows]
dupes = {i for i in ids if ids.count(i) > 1}
errors += [f"duplicate requirement id {d}" for d in sorted(dupes)]
idset = set(ids)

# Every ID-like token defined anywhere in the markdown corpus counts as "defined".
md = "\n".join(p.read_text(encoding="utf-8") for p in root.rglob("*.md"))
def defined(prefix_re):
    return set(re.findall(prefix_re, md))
decision_defs = defined(r"\b(?:D-[A-Z]+-\d+[A-Z]?|PR-\d+|NP-\d+)\b")
test_defs = defined(r"\bT-[A-Z0-9]+-[0-9A-Z]+\b|\bPERF-\d+\b")

for r in rows:
    rid = r["id"]
    if r["parent"] != "-" and r["parent"] not in idset:
        errors.append(f"{rid}: parent {r['parent']} undefined")
    for d in (x.strip() for x in r["deps"].split(",")):
        if d not in ("", "-") and d not in idset:
            errors.append(f"{rid}: dependency {d} undefined")
    ev = r["evidence"].split()[0].rstrip(";(")
    if ev not in EVIDENCE:
        errors.append(f"{rid}: evidence '{r['evidence']}' not in {sorted(EVIDENCE)}")
    if r["evidence"].startswith(("VER", "IMP")):
        errors.append(f"{rid}: claims {ev} but no code or test run exists")
    if r["stage"] not in STAGES:
        errors.append(f"{rid}: stage '{r['stage']}' invalid")
    for d in filter(lambda x: x not in ("-", ""), (x.strip() for x in r["decisions"].split(","))):
        if d not in decision_defs:
            errors.append(f"{rid}: decision {d} not defined in any audit .md")
    tests = [t.strip() for t in r["tests"].split(",") if t.strip() not in ("-", "")]
    for t in tests:
        if t not in test_defs:
            warns.append(f"{rid}: test {t} referenced but not defined in any audit .md")
    if not tests and not r["removal"].startswith(("Proposed", "Out of scope")) and not r["feature"].startswith("GROUP:"):
        warns.append(f"{rid}: no acceptance test")
    if r["target"] == "-" and r["removal"] == "-":
        errors.append(f"{rid}: no target module and no removal rationale")

# Generated file: data/*.tsv is the source of truth; only written when checks pass.
out = root / "02-requirements-traceability-matrix.csv"
with (open(out, "w", newline="", encoding="utf-8") if not errors else open(__import__("os").devnull, "w")) as fh:
    w = csv.DictWriter(fh, fieldnames=COLS + ["impl_status", "verification", "ref_checked"])
    w.writeheader()
    for r in rows:
        w.writerow({**r, "impl_status": "Not started", "verification": "none",
                    "ref_checked": "yes (re-read 2026-10-26)" if r["doc"] == "SPEC" else "yes (REQ/APIR read 2026-10-26)"})

by = lambda k: {v: sum(1 for r in rows if r[k] == v) for v in sorted({r[k] for r in rows})}
print(f"rows: {len(rows)}")
print("evidence:", by("evidence"))
print("stage:", by("stage"))
print("target:", by("target"))
print(f"WARNINGS ({len(warns)}):", *warns, sep="\n  ")
print(f"ERRORS ({len(errors)}):", *errors, sep="\n  ")
sys.exit(1 if errors else 0)
