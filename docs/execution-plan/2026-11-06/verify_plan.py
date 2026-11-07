"""Check execution-plan integrity; never marks service gates passed.
Run with Python 3: python docs/execution-plan/2026-11-06/verify_plan.py
"""
from pathlib import Path
from urllib.parse import unquote
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
errors = []
checks = []
plan = json.loads((ROOT / "execution.json").read_text(encoding="utf-8"))
tasks = {x["id"]: x for x in plan["tasks"]}
gates = {x["id"]: x for x in plan["gates"]}
criteria = {x["id"]: x for x in plan["criteria"]}
issues = {x["id"]: x for x in plan["issues"]}
for key, collection, mapping in [("tasks", plan["tasks"], tasks), ("gates", plan["gates"], gates),
                                 ("criteria", plan["criteria"], criteria), ("issues", plan["issues"], issues)]:
    if len(collection) != len(mapping):
        errors.append("Duplicate IDs in " + key)
if len(tasks) != 10 or len(gates) != 8 or len(criteria) != 32 or len(issues) != 33:
    errors.append("Unexpected number of tasks/gates/criteria/issues; update scope deliberately")
checks.append("Unique IDs and expected coverage")

def check_dag(nodes, name):
    active, done = set(), set()
    def visit(key):
        if key in active:
            errors.append(name + " dependency cycle: " + key)
            return
        if key in done:
            return
        active.add(key)
        for dep in nodes[key]["dependsOn"]:
            if dep not in nodes:
                errors.append(name + " missing dependency: " + dep)
            else:
                visit(dep)
        active.remove(key)
        done.add(key)
    for key in nodes:
        visit(key)

check_dag(tasks, "task")
check_dag(gates, "gate")
checks.append("Task and gate dependency DAGs")

for ac in criteria.values():
    if ac["work"] not in tasks or ac["gate"] not in gates:
        errors.append("Unknown work/gate for " + ac["id"])
        continue
    if ac["id"] not in tasks[ac["work"]]["criteria"] or ac["id"] not in gates[ac["gate"]]["criteria"]:
        errors.append("Criterion reverse mapping missing: " + ac["id"])
    if ac["status"] not in {"not_run", "pass", "fail", "blocked"}:
        errors.append("Invalid criterion status: " + ac["id"])
    if ac["status"] == "pass" and not ac["evidencePaths"]:
        errors.append("Pass without evidence: " + ac["id"])
    for entry in ac["evidencePaths"]:
        if not entry.startswith(("https://", "http://")) and not (ROOT / entry).exists():
            errors.append("Missing criterion evidence: " + entry)

for task in tasks.values():
    if not task["criteria"]:
        errors.append("Task without acceptance criteria: " + task["id"])
    if task["status"] not in {"planned", "in_progress", "blocked", "complete"}:
        errors.append("Invalid task status: " + task["id"])
    for ac in task["criteria"]:
        if ac not in criteria or criteria[ac]["work"] != task["id"]:
            errors.append("Task/criterion mismatch: " + task["id"])
    if task["status"] == "complete":
        if any(tasks[d]["status"] != "complete" for d in task["dependsOn"] if d in tasks):
            errors.append("Completed task with incomplete dependency: " + task["id"])
        if any(criteria[c]["status"] != "pass" for c in task["criteria"] if c in criteria):
            errors.append("Completed task with unpassed criterion: " + task["id"])

for gate in gates.values():
    if gate["status"] not in {"not_run", "pass", "fail", "blocked"}:
        errors.append("Invalid gate status: " + gate["id"])
    if not gate["criteria"]:
        errors.append("Empty gate: " + gate["id"])
    for ac in gate["criteria"]:
        if ac not in criteria or criteria[ac]["gate"] != gate["id"]:
            errors.append("Gate/criterion mismatch: " + gate["id"])
    if gate["status"] == "pass":
        if not gate["reviewEvidence"]:
            errors.append("Passed gate lacks review evidence: " + gate["id"])
        if any(gates[d]["status"] != "pass" for d in gate["dependsOn"] if d in gates):
            errors.append("Passed gate with unpassed dependency: " + gate["id"])
        if any(criteria[c]["status"] != "pass" for c in gate["criteria"] if c in criteria):
            errors.append("Passed gate with unpassed criterion: " + gate["id"])

for issue in issues.values():
    if not issue["works"] or not issue["criteria"]:
        errors.append("Unmapped issue: " + issue["id"])
    for work in issue["works"]:
        if work not in tasks:
            errors.append("Issue refers to missing work: " + issue["id"])
    for ac in issue["criteria"]:
        if ac not in criteria:
            errors.append("Issue refers to missing criterion: " + issue["id"])
        elif criteria[ac]["work"] not in issue["works"]:
            errors.append("Issue omits criterion implementation work: " + issue["id"] + "/" + ac)
    if not isinstance(issue.get("releaseRequired"), bool):
        errors.append("Issue must explicitly state release scope: " + issue["id"])
    if issue.get("releaseRequired") and "AC31" in issue["criteria"]:
        errors.append("Release closure cycle through AC31: " + issue["id"])
    if issue["status"] not in {"open", "in_progress", "blocked", "accepted_deferred", "closed"}:
        errors.append("Invalid issue status: " + issue["id"])
    if issue["status"] == "closed":
        if not issue["resolutionEvidence"]:
            errors.append("Closed issue lacks resolution evidence: " + issue["id"])
        if any(criteria[c]["status"] != "pass" for c in issue["criteria"] if c in criteria):
            errors.append("Closed issue has unpassed criterion: " + issue["id"])
if criteria["AC31"]["status"] == "pass":
    if any(i.get("releaseRequired") and i["status"] != "closed" for i in issues.values()):
        errors.append("AC31 passed with unresolved release-required issue")
checks.append("Task/issue/criterion links and evidence-dependent status rules")

link_count = 0
for file in ROOT.glob("*.md"):
    text = file.read_text(encoding="utf-8")
    for match in re.finditer(r"\]\((<[^>]+>|[^)]+)\)", text):
        target = match.group(1).strip("<>")
        if target.startswith(("https://", "http://", "#")):
            continue
        target = unquote(target.split("#")[0])
        path = Path(target) if re.match(r"^[A-Za-z]:/", target) else file.parent / target
        if not path.exists() and target != "document-check.json":
            errors.append(file.name + ": missing local link " + target)
        link_count += 1
    for pattern, mapping in [(r"\bW\d{2}\b", tasks), (r"\bF\d{2}\b", issues), (r"\bAC\d{2}\b", criteria)]:
        for ref in set(re.findall(pattern, text)):
            if ref not in mapping:
                errors.append(file.name + ": unknown ID " + ref)

table = (ROOT / "04-issues.md").read_text(encoding="utf-8")
for issue_id in issues:
    if len(re.findall(r"^\| " + issue_id + r" \|", table, re.M)) != 1:
        errors.append("Missing/duplicate issue table row: " + issue_id)
quality = (ROOT / "03-quality-gates.md").read_text(encoding="utf-8")
for ac_id in criteria:
    if len(re.findall(r"^### " + ac_id + r" · ", quality, re.M)) != 1:
        errors.append("Missing/duplicate acceptance heading: " + ac_id)
checks.append("Local links and report/manifest coverage")

preservation = json.loads((ROOT / "archive-preservation.json").read_text(encoding="utf-8"))
preserved = 0
expected = set()
for item in preservation["files"]:
    path = WORKSPACE / item["path"]
    expected.add(path.resolve())
    if not path.exists():
        errors.append("Archive file removed: " + item["path"])
        continue
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != item["sha256"]:
        errors.append("Archive changed: " + item["path"])
    else:
        preserved += 1
archive_root = WORKSPACE / "docs" / "project-baseline" / "2026-11-06"
actual_files = {p.resolve() for p in archive_root.rglob("*") if p.is_file()}
if actual_files != expected:
    errors.append("Archive file inventory changed")
checks.append("Original archive SHA256 and file inventory unchanged")

result = {"ok": not errors, "checks": checks, "tasks": len(tasks), "gates": len(gates),
          "criteria": len(criteria), "issues": len(issues), "localLinks": link_count,
          "archiveFilesPreserved": preserved, "errors": errors,
          "scope": "Document structure/status integrity only; service verification is separate"}
(ROOT / "document-check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(1 if errors else 0)

