"""Generate the FRD from the audit pack so it can never drift from the matrix.

Usage: python -I docs/requirements/tools/build_frd.py <repo_root>
Reads:  docs/audit/data/matrix-*.tsv, 05 (workflows), 07 (invariants), revisions/v1.1 (NFRs)
        docs/requirements/src/frd-front.md (hand-written front matter)
Writes: docs/requirements/FRD-GEMS-OMNIX.md
"""
import collections, glob, pathlib, re, sys

root = pathlib.Path(sys.argv[1])
audit = root / "docs" / "audit"
out_dir = root / "docs" / "requirements"
COLS = ["id", "parent", "doc", "page", "feature", "path", "details", "perms", "target",
        "deps", "evidence", "owner", "decisions", "tests", "migration", "removal", "stage"]

rows = []
for f in sorted(glob.glob(str(audit / "data" / "matrix-*.tsv"))):
    lines = pathlib.Path(f).read_text(encoding="utf-8").splitlines()
    for line in lines[1:] if lines and lines[0].startswith("id	") else lines:  # same rule as build_matrix.py
        if line.strip():
            rows.append(dict(zip(COLS, line.split("\t"))))
assert len(rows) == 290, f"expected 290 matrix rows, got {len(rows)}"

MODULES = [  # (target key, title), in business-flow order
    ("org", "Organisation and centres"),
    ("core", "Platform core: search, navigation, roles, numbering, logs"),
    ("catalogue", "Course catalogue"),
    ("crm", "Enquiries and CRM"),
    ("students", "Student records and admission"),
    ("academics", "Academics: batches, attendance, syllabus, placement"),
    ("fees", "Fees, schemes and concessions"),
    ("payments", "Payments and gateways"),
    ("accounts", "Accounting"),
    ("royalty", "Royalty and clearance"),
    ("tickets", "Tickets and approvals"),
    ("exams", "Examinations"),
    ("certs", "Certificates"),
    ("supply", "Vouchers, licences, materials and SAP"),
    ("hrms", "Human resources (HRMS)"),
    ("reports", "Reports and dashboards"),
    ("comms", "Notifications and communications"),
    ("integration", "Integrations: legacy Centres API"),
    ("-", "Proposed out of scope (pending usage evidence and owner sign-off)"),
]
STAGES = {"S0": "0 Discovery", "S1": "1 Security POC", "S2": "2 Data model, numbering, audit, ticket core",
          "S3": "3 Centre, catalogue, enquiry, admission", "S4": "4 Fees, receipts, payments, accounting",
          "S5": "5 Ticket workflows", "S6": "6 Exams, certificates, supply, royalty, year close",
          "S7": "7 HRMS, reports, integrations, hardening", "S8": "8 Rehearsal, UAT, cutover"}
module_of = lambda r: "academics" if r["target"] == "academics/accounts" else r["target"]
assert {module_of(r) for r in rows} <= {m for m, _ in MODULES}, "unmapped target module"

def num(rid):
    m = re.match(r"R-(\d+)", rid)
    return int(m.group(1)) if m else -1

# Workflow -> requirement links from 05 (handles "R-110…R-122*" ranges and "*" = include children)
wf_text = (audit / "05-workflow-to-test-mapping.md").read_text(encoding="utf-8")
wf_of = collections.defaultdict(set)
for line in wf_text.splitlines():
    m = re.match(r"\| (WF[-\w]+) \| ([^|]+) \|", line)
    if not m:
        continue
    wf, name = m.group(1), m.group(2).strip()
    cells = line.split("|")
    req_cell = next((c for c in cells if "R-" in c), "")
    for a, b, star in re.findall(r"(R-\d+(?:\.\d+)?)(?:…(R-\d+(?:\.\d+)?))?(\*)?", req_cell):
        for r in rows:
            rid = r["id"]
            hit = (rid == a or (star and rid.startswith(a + "."))
                   or (b and num(a) <= num(rid) <= num(b)))
            if hit:
                wf_of[rid].add(f"{wf} {name}")

def section(path, start, stop):
    text = path.read_text(encoding="utf-8")
    i = text.index(start)
    j = text.index(stop, i + len(start))
    return text[i:j].strip()

esc = lambda s: (s or "-").replace("|", "\\|").strip() or "-"
split = lambda s: [x.strip() for x in s.split(",") if x.strip() not in ("", "-")]

out = [(out_dir / "src" / "frd-front.md").read_text(encoding="utf-8").rstrip(), ""]

# Section 5: financial invariants and NFRs, quoted from their sources
out += ["## 5. System-wide financial invariants", "",
        "Quoted verbatim from `docs/audit/07-financial-invariants-and-transactions.md` §2. "
        "Approval state as recorded there; nothing here is approved by this FRD.", "",
        section(audit / "07-financial-invariants-and-transactions.md", "| ID | Invariant", "## 3."), "",
        "## 6. Non-functional requirements (all thresholds PROPOSED, decision D-OPS-1)", "",
        "Quoted from `docs/audit/revisions/v1.1-corrections.md` C-06. RLS overhead is superseded by "
        "v1.3 C-20 (absolute per-statement threshold, to be measured in-region).", "",
        section(audit / "revisions" / "v1.1-corrections.md", "| ID | Scenario | Measure |", "**Tooling:**"), ""]

# Section 7: traceability summary
by_mod = collections.Counter(module_of(r) for r in rows)
by_stage = collections.Counter(r["stage"] for r in rows)
ev = collections.Counter("Mixed SRC/REC" if ";" in r["evidence"] else r["evidence"].split()[0] for r in rows)
out += ["## 7. Traceability summary (computed from the matrix)", "",
        "| Module | Requirements | Stages |", "|---|---|---|"]
for key, title in MODULES:
    st = sorted({r["stage"] for r in rows if module_of(r) == key})
    out.append(f"| {title} | {by_mod[key]} | {', '.join(st)} |")
out += [f"| **Total** | **{len(rows)}** | |", "",
        "| Stage | Rows |", "|---|---|"] + [f"| {STAGES[s]} | {by_stage[s]} |" for s in sorted(by_stage)] + ["",
        "| Evidence | Rows |", "|---|---|"] + [f"| {k} | {v} |" for k, v in sorted(ev.items())] + [
        "| VER (verified by test) | 0 |", "| IMP (implemented) | 0 |", ""]

# Section 8: requirements by module
out += ["## 8. Functional requirements by module", "",
        "Each entry is one row of the traceability matrix. `FR-x` = matrix `R-x`. "
        "Acceptance status of every requirement: **not verified (0 application tests run)**.", ""]
for n, (key, title) in enumerate(MODULES, 1):
    mod_rows = sorted((r for r in rows if module_of(r) == key), key=lambda r: (num(r["id"]), r["id"]))
    owners = collections.Counter(r["owner"] for r in mod_rows)
    decs = sorted({d for r in mod_rows for d in split(r["decisions"])})
    wfs = sorted({w for r in mod_rows for w in wf_of[r["id"]]})
    tests = {t for r in mod_rows for t in split(r["tests"])}
    out += [f"### 8.{n} {title}", "",
            f"- **Requirements:** {len(mod_rows)}",
            f"- **Owners:** {', '.join(f'{o} ({c})' for o, c in owners.most_common())}",
            f"- **Workflows (05):** {'; '.join(wfs) if wfs else 'none mapped'}",
            f"- **Open decisions (04):** {', '.join(decs) if decs else 'none'}",
            f"- **Distinct acceptance tests (09):** {len(tests)}", ""]
    for r in mod_rows:
        parent = f" (part of FR-{r['parent'][2:]})" if r["parent"] != "-" else ""
        src = f"{r['doc']} p.{r['page']}"
        rec = r["evidence"].startswith("REC") or "REC" in r["evidence"]
        out += [f"#### FR-{r['id'][2:]}: {esc(r['feature'])}{parent}", "",
                "| Field | Value |", "|---|---|",
                f"| Description (legacy behaviour) | {esc(r['details'])} |",
                f"| Source | {esc(src)}; legacy path `{esc(r['path'])}` |",
                f"| Evidence class | {esc(r['evidence'])}{' (needs centre-side or manager verification)' if rec else ''} |",
                f"| Actors / permissions | {esc(r['perms'])} |",
                f"| Depends on | {esc(', '.join('FR-' + d[2:] for d in split(r['deps'])))} |",
                f"| Business owner | {esc(r['owner'])} |",
                f"| Open decisions | {esc(', '.join(split(r['decisions'])))} |",
                f"| Acceptance tests | {esc(', '.join(split(r['tests'])))} |",
                f"| Workflows | {esc('; '.join(sorted(wf_of[r['id']])))} |",
                f"| Data migration | {esc(r['migration'])} |",
                f"| Delivery stage | {STAGES[r['stage']]} |"]
        if r["removal"] not in ("", "-"):
            out.append(f"| Removal / scope note (UNAPPROVED) | {esc(r['removal'])} |")
        out.append("")

(out_dir / "FRD-GEMS-OMNIX.md").write_text("\n".join(out) + "\n", encoding="utf-8")
mapped = sum(1 for r in rows if wf_of[r["id"]])
print(f"FRD written: {len(rows)} requirements in {len(MODULES)} modules; {mapped} linked to a workflow")
