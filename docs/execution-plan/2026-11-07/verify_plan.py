"""Validate ARTI v2 plan structure, prerequisites, evidence paths, and protected archives.
This never marks product gates passed or verifies actual application behavior.
"""
from pathlib import Path
from urllib.parse import unquote
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
plan = json.loads((ROOT / "execution.json").read_text(encoding="utf-8"))
errors = []
checks = []
collections = {}
for key in ("tasks", "gates", "criteria", "issues"):
    rows = plan[key]
    collections[key] = {x["id"]: x for x in rows}
    if len(rows) != len(collections[key]):
        errors.append("Duplicate IDs: " + key)
tasks, gates, acs, issues = (collections[k] for k in ("tasks","gates","criteria","issues"))
expected_counts = {"tasks":12,"gates":10,"criteria":33,"issues":37}
for key, count in expected_counts.items():
    if len(collections[key]) != count:
        errors.append("Unexpected coverage: " + key)
if plan.get("baseline", {}).get("commit") != "ae0e58ebc338c17da6d4d17616fd802f03ba3bb6":
    errors.append("Baseline differs from user-adopted commit; revise explicitly")
checks.append("Unique IDs, baseline, and expected coverage")
if 'serviceGateState' in plan:
    errors.append('Legacy summary field serviceGateState is forbidden; derive status from tasks/gates.')

def evidence(entries, label, required=False):
    if required and not entries:
        errors.append(label + " lacks evidence")
    for value in entries:
        if not isinstance(value,str):
            errors.append(label + " invalid evidence path")
            continue
        if value.startswith(("https://","http://")):
            continue
        if not (ROOT / value).is_file():
            errors.append("Missing evidence file: " + label + ": " + value)

def require_gates(ids, label):
    for key in ids:
        if key not in gates or gates[key]["status"] != "pass":
            errors.append("Required gate not passed: " + label + "/" + key)

def require_tasks(ids, label):
    for key in ids:
        if key not in tasks or tasks[key]["status"] != "complete":
            errors.append("Required task not complete: " + label + "/" + key)

for a in acs.values():
    if a["work"] not in tasks or a["gate"] not in gates:
        errors.append("Unknown work/gate: " + a["id"])
        continue
    if a["id"] not in tasks[a["work"]]["criteria"] or a["id"] not in gates[a["gate"]]["criteria"]:
        errors.append("Criterion reverse mapping: " + a["id"])
    if a["status"] not in {"not_run","pass","fail","blocked"}:
        errors.append("Invalid AC status: " + a["id"])
    evidence(a["evidencePaths"], a["id"], a["status"]=="pass")

graph = {}
for t in tasks.values():
    key = t["id"]
    for field in ("requiredGates","completionDependsOn","completionGates"):
        if field not in t:
            errors.append("Missing task prerequisite field: " + key + "/" + field)
    task_deps = t["dependsOn"] + t.get("completionDependsOn",[])
    gate_deps = t.get("requiredGates",[]) + t.get("completionGates",[])
    for dep in task_deps:
        if dep not in tasks: errors.append("Unknown task dependency: " + key + "/" + dep)
    for dep in gate_deps:
        if dep not in gates: errors.append("Unknown gate dependency: " + key + "/" + dep)
    graph["T:"+key] = ["T:"+d for d in task_deps if d in tasks] + ["G:"+d for d in gate_deps if d in gates]
    if t["status"] not in {"planned","in_progress","blocked","complete"}:
        errors.append("Invalid task status: " + key)
    if not t["criteria"]: errors.append("Empty task criteria: " + key)
    for a in t["criteria"]:
        if a not in acs or acs[a]["work"] != key: errors.append("Task/AC mismatch: " + key)
    if t["status"] in {"in_progress","complete"}:
        require_tasks(t["dependsOn"], key)
        require_gates(t.get("requiredGates",[]), key)
    if t["status"] == "complete":
        require_tasks(t.get("completionDependsOn",[]), key)
        require_gates(t.get("completionGates",[]), key)
        if any(a not in acs or acs[a]["status"] != "pass" for a in t["criteria"]):
            errors.append("Completed task with unpassed criterion: " + key)

for g in gates.values():
    key = g["id"]
    owners = sorted({acs[a]["work"] for a in g["criteria"] if a in acs})
    graph["G:"+key] = ["G:"+d for d in g["dependsOn"] if d in gates] + ["T:"+d for d in owners if d in tasks]
    for dep in g["dependsOn"]:
        if dep not in gates: errors.append("Unknown gate prerequisite: " + key + "/" + dep)
    if not g["criteria"]: errors.append("Empty gate criteria: " + key)
    for a in g["criteria"]:
        if a not in acs or acs[a]["gate"] != key: errors.append("Gate/AC mismatch: " + key)
    if g["status"] not in {"not_run","pass","fail","blocked"}: errors.append("Invalid gate status: " + key)
    evidence(g["reviewEvidence"], key + " review", g["status"]=="pass")
    if g["status"] == "pass":
        require_gates(g["dependsOn"], key)
        require_tasks(owners, key)
        if any(a not in acs or acs[a]["status"] != "pass" for a in g["criteria"]):
            errors.append("Passed gate with unpassed criterion: " + key)

active, done = set(),set()
def walk(key):
    if key in active:
        errors.append("Mixed dependency cycle: " + key)
        return
    if key in done: return
    active.add(key)
    for dep in graph.get(key,[]): walk(dep)
    active.remove(key)
    done.add(key)
for key in graph: walk(key)
checks.append("Task/gate mixed DAG, start and completion prerequisites, review evidence")

for i in issues.values():
    key=i["id"]
    if not i["works"] or not i["criteria"]: errors.append("Unmapped issue: " + key)
    for w in i["works"]:
        if w not in tasks: errors.append("Issue unknown work: " + key)
    for a in i["criteria"]:
        if a not in acs: errors.append("Issue unknown AC: " + key)
        elif acs[a]["work"] not in i["works"]: errors.append("Issue omits criterion implementation work: " + key)
    if not isinstance(i.get("releaseRequired"),bool): errors.append("Missing issue release scope: " + key)
    if i.get("releaseRequired") and "AC31" in i["criteria"]: errors.append("Release closure cycle: " + key)
    if i["status"] not in {"open","verification_pending","in_progress","blocked","accepted_deferred","closed"}:
        errors.append("Invalid issue status: " + key)
    if i["status"]=="closed":
        evidence(i["resolutionEvidence"], key, True)
        if not re.fullmatch(r"[0-9a-fA-F]{40}",i.get("resolvedCommit") or ""):
            errors.append("Closed issue lacks resolved commit: " + key)
        if any(a not in acs or acs[a]["status"]!="pass" for a in i["criteria"]):
            errors.append("Closed issue with unpassed criterion: " + key)
if acs.get("AC31",{}).get("status")=="pass" and any(i.get("releaseRequired") and i["status"]!="closed" for i in issues.values()):
    errors.append("AC31 has unresolved release-required issue")
choice=plan.get("operations",{}).get("postgresDeployment")
if choice not in {"undecided","rds","self_managed","other_postgresql"}:
    errors.append("Unknown PostgreSQL operations choice")
if gates["GOPS"]["status"]=="pass" and choice=="undecided":
    errors.append("GOPS passed without PostgreSQL operations decision")
checks.append("Issue closure and conditional PostgreSQL operating choice")

# 현재 판정은 과거 관측을 지우지 않고 근거·잔여 조건과 함께 유지합니다.
review=plan.get('issueReconciliation')
if review:
    evidence([review['record'],review['snapshot']], 'Issue reconciliation', True)
    snapshot_path=ROOT/review['snapshot']
    if snapshot_path.is_file():
        snapshot=json.loads(snapshot_path.read_text(encoding='utf-8'))
        before={i['id']:i for i in snapshot['issues']}
        ancestors={}
        if set(before)!=set(issues):errors.append('Reconciliation snapshot issue coverage differs')
        for key,i in issues.items():
            for field in ('title','criteria','works'):
                if key in before and i[field]!=before[key][field]:
                    errors.append('Reconciliation changed original mapping: '+key+'/'+field)
            current=i.get('currentReview',{})
            if not all(current.get(k) for k in ('asOf','implemented','remaining','nextWork','evidencePaths')):
                errors.append('Issue current review incomplete: '+key)
            evidence(current.get('evidencePaths',[]),key+' current review',True)
            if i['status']=='closed':
                if not current.get('remaining','').startswith('없음:'):
                    errors.append('Closed issue still has remaining acceptance: '+key)
                sha=i.get('resolvedCommit') or ''
                if re.fullmatch(r'[0-9a-fA-F]{40}',sha):
                    if sha not in ancestors:
                        ancestors[sha]=subprocess.run(['git','merge-base','--is-ancestor',sha,'HEAD'],cwd=WORKSPACE,capture_output=True).returncode
                    if ancestors[sha]:errors.append('Resolved commit is not in local ancestry: '+key)
        # 사용자가 결정한 Git 인수 경계는 자료 부재 확인이나 고유 자료 이전 성공이 아닙니다.
        local=issues['F37']
        if local['releaseRequired'] or local['status']=='closed' or not local.get('scopeDecision'):
            errors.append('Local unique intake scope decision lost')
        evidence([local.get('scopeDecision','')],'F37 scope',True)
    checks.append('Current issue review, historical snapshot and Git intake boundary')

link_count=0
generated={"document-check.json","guardrail-check.json"}
for file in ROOT.glob("*.md"):
    text=file.read_text(encoding="utf-8")
    for target in re.findall(r"\]\((<[^>]+>|[^)]+)\)",text):
        target=target.strip("<>")
        if target.startswith(("https://","http://","#")): continue
        target=unquote(target.split("#")[0])
        path=Path(target) if re.match(r"^[A-Za-z]:/",target) else file.parent/target
        if not path.exists() and target not in generated:
            errors.append(file.name + ": missing local link " + target)
        link_count+=1
    for pattern,mapping in [(r"\bW\d{2}\b",tasks),(r"\bF\d{2}\b",issues),(r"\bAC\d{2}\b",acs)]:
        for ref in set(re.findall(pattern,text)):
            if ref not in mapping: errors.append(file.name+": unknown ID "+ref)
table=(ROOT/"04-issues.md").read_text(encoding="utf-8")
quality=(ROOT/"03-quality-gates.md").read_text(encoding="utf-8")
for key in issues:
    if len(re.findall(r"^\| "+key+r" \|",table,re.M))!=1: errors.append("Issue row mismatch: "+key)
    if review and not re.search(r'^\| '+key+r' \| '+issues[key]['status']+r' \|',table,re.M):
        errors.append('Issue table status differs from manifest: '+key)
for key in acs:
    if len(re.findall(r"^### "+key+r" · ",quality,re.M))!=1: errors.append("AC heading mismatch: "+key)
    if "**기준:** "+acs[key]["criterion"]+"." not in quality:
        errors.append("AC text differs from manifest: "+key)
checks.append("Local links and document ID coverage")

persona_review=plan.get("personaReview")
if persona_review:
    persona_ids={p["id"] for p in persona_review["personas"]}
    improvement_ids=set()
    for item in persona_review["improvements"]:
        if item["id"] in improvement_ids: errors.append("Duplicate persona improvement: "+item["id"])
        improvement_ids.add(item["id"])
        if any(p not in persona_ids for p in item["personas"]): errors.append("Unknown improvement persona: "+item["id"])
        if any(w not in tasks for w in item["works"]): errors.append("Unknown improvement work: "+item["id"])
        for key in item["criteria"]:
            if key not in acs: errors.append("Unknown improvement AC: "+item["id"])
            elif acs[key]["work"] not in item["works"]: errors.append("Improvement omits AC work: "+item["id"])
    scenarios=json.loads((ROOT/"persona-scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    for scenario in scenarios:
        if any(a not in acs for a in scenario["criteria"]): errors.append("Unknown persona scenario AC: "+scenario["id"])
        evidence(scenario["evidencePaths"],scenario["id"],scenario["status"]=="pass")
    checks.append("Persona improvement and scenario traceability")

protected=json.loads((ROOT/"archive-preservation.json").read_text(encoding="utf-8"))["protected"]
preserved=0
for group in protected:
    expected=set()
    for item in group["files"]:
        path=WORKSPACE/item["path"]
        expected.add(path.resolve())
        if not path.is_file(): errors.append("Protected file removed: "+item["path"])
        elif hashlib.sha256(path.read_bytes()).hexdigest()!=item["sha256"]:
            errors.append("Protected file changed: "+item["path"])
        else: preserved+=1
    actual={p.resolve() for p in (WORKSPACE/group["root"]).rglob("*") if p.is_file()}
    if actual!=expected: errors.append("Protected inventory changed: "+group["root"])
checks.append("Original archive and v1 inventory/SHA256 unchanged")
result={"ok":not errors,"checks":checks,"tasks":len(tasks),"gates":len(gates),"criteria":len(acs),
        "issues":len(issues),"localLinks":link_count,"protectedFilesPreserved":preserved,"errors":errors,
        "scope":"Plan integrity only; no actual service/model/cloud acceptance"}
(ROOT/"document-check.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(result,ensure_ascii=True,indent=2))
raise SystemExit(1 if errors else 0)

