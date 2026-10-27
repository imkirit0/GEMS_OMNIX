# GEMS OMNIX: project instructions for AI assistants

EGM artifact directory: docs/designs

- Progress tracker: `docs/STATUS.md` (update with every change; evidence wins over memory).
- Evidence log: `docs/audit/12-evidence-and-verification-log.md` (append-only).
- Every requirement and rule carries an evidence class: SRC, INF, REC, PRO, PMC, VER, IMP (see `docs/audit/00-README.md`).
- Proposed business defaults (PMC) are parameters, never shipped rules, until their owner signs (`docs/audit/04-manager-decision-register.md`).
- "Green" means `bash scripts/ci.sh` exits 0. It recreates the local Docker database.
