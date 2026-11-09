"""Validate archive structure, references, and task dependency integrity (stdlib only)."""
import json
import re
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
errors = []
tasks = {t["id"]: t for t in plan["tasks"]}
if len(tasks) != len(plan["tasks"]):
    errors.append("Duplicate task IDs")
active, done = set(), set()

def visit(key):
    if key in active:
        errors.append("Dependency cycle: " + key)
        return
    if key in done:
        return
    active.add(key)
    for dep in tasks[key]["dependsOn"]:
        if dep not in tasks:
            errors.append("Unknown dependency: " + dep)
        else:
            visit(dep)
    active.remove(key)
    done.add(key)

for key in tasks:
    visit(key)
if [t["id"] for t in plan["tasks"] if t["status"] == "complete"] != ["T00"]:
    errors.append("Only investigation T00 may be marked complete in this baseline")
link_count = 0
for file in ROOT.glob("*.md"):
    body = file.read_text(encoding="utf-8")
    # Local links in controlled report files; raw Notion snapshots are evidence, not rewritten.
    for target in re.findall(r"\]\((<[^>]+>|[^)]+)\)", body):
        target = target.strip("<>")
        if target.startswith(("https://", "http://", "#")):
            continue
        target = unquote(target.split("#")[0])
        path = Path(target) if re.match(r"^[A-Za-z]:/", target) else file.parent / target
        if not path.exists():
            errors.append(f"{file.name}: missing link {target}")
        link_count += 1
findings = (ROOT / "02-findings.md").read_text(encoding="utf-8")
rows = [r for r in findings.splitlines() if re.match(r"\| F\d{2} \|", r)]
ids = [re.search(r"F\d{2}", r).group() for r in rows]
if len(ids) != len(set(ids)) or len(ids) != 21:
    errors.append("Expected 21 distinct findings")
for row in rows:
    refs = re.findall(r"T\d{2}", row)
    if not refs or any(ref not in tasks for ref in refs):
        errors.append("Unmapped finding: " + row[:30])
for source in plan["notionSources"]:
    if not (ROOT / source["file"]).exists():
        errors.append("Missing source snapshot: " + source["id"])
result = {"ok": not errors, "tasks": len(tasks), "findings": len(rows),
          "notionSnapshots": len(plan["notionSources"]), "localLinks": link_count,
          "errors": errors}
(ROOT / "archive-check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(1 if errors else 0)

