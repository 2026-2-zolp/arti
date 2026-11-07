"""Read-only candidate-state tests for v2 validator.
All fake pass records below are in-memory test fixtures, never real gate evidence.
"""
from pathlib import Path
from contextlib import redirect_stdout
import copy
import io
import json
import runpy

ROOT=Path(__file__).resolve().parent
manifest=ROOT/"execution.json"
report=ROOT/"document-check.json"
base=json.loads(manifest.read_text(encoding="utf-8"))
# Candidate fixtures start fresh so live W01/G0 progress never weakens negative probes.
for task in base["tasks"]:
    task["status"]="planned"
for ac in base["criteria"]:
    ac.update(status="not_run",evidencePaths=[])
for gate in base["gates"]:
    gate.update(status="not_run",reviewEvidence=[])
for issue in base["issues"]:
    if issue["status"]=="closed":
        issue["status"]="open"
    issue.update(resolutionEvidence=[],resolvedCommit=None)
base["operations"]["postgresDeployment"]="undecided"
read_original,write_original=Path.read_text,Path.write_text

def lookup(p,key):
    section={"W":"tasks","G":"gates","A":"criteria","F":"issues"}[key[0]]
    return next(x for x in p[section] if x["id"]==key)

def pass_ac(p,key):
    lookup(p,key).update(status="pass",evidencePaths=["records/README.md"])

def complete_task(p,key):
    t=lookup(p,key)
    if t["status"]=="complete": return
    for d in t["dependsOn"]+t["completionDependsOn"]: complete_task(p,d)
    for d in t["requiredGates"]+t["completionGates"]: pass_gate(p,d)
    for ac in t["criteria"]: pass_ac(p,ac)
    t["status"]="complete"

def pass_gate(p,key):
    g=lookup(p,key)
    if g["status"]=="pass": return
    for d in g["dependsOn"]: pass_gate(p,d)
    for ac in g["criteria"]: complete_task(p,lookup(p,ac)["work"])
    if key=="GOPS": p["operations"]["postgresDeployment"]="self_managed"
    g.update(status="pass",reviewEvidence=["records/README.md"])

def start_task(p,key):
    t=lookup(p,key)
    for d in t["dependsOn"]: complete_task(p,d)
    for d in t["requiredGates"]: pass_gate(p,d)
    t["status"]="in_progress"

def bypass_gate_complete(p):
    complete_task(p,"W02")
    lookup(p,"G0")["status"]="not_run"

def bypass_gate_start(p):
    complete_task(p,"W01")
    lookup(p,"W02")["status"]="in_progress"

def missing_review(p):
    pass_gate(p,"G0")
    lookup(p,"G0")["reviewEvidence"]=["records/nonexistent-review.md"]

def ci_finish_too_early(p):
    start_task(p,"W11")
    pass_ac(p,"AC07")
    lookup(p,"W11")["status"]="complete"

def gate_without_review(p):
    pass_gate(p,"G0")
    lookup(p,"G0")["reviewEvidence"]=[]

def operations_undecided(p):
    pass_gate(p,"GOPS")
    p["operations"]["postgresDeployment"]="undecided"

def gate_without_completed_owner(p):
    pass_gate(p,"G0")
    lookup(p,"W01")["status"]="planned"

def cloud_without_operations_gate(p):
    complete_task(p,"W04")
    pass_gate(p,"G3")
    complete_task(p,"W12")
    lookup(p,"W08")["status"]="in_progress"

def closed_without_commit(p):
    i=lookup(p,"F03")
    i.update(status="closed",resolutionEvidence=["records/README.md"])
    for ac in i["criteria"]: pass_ac(p,ac)

def local_with_external_wait(p):
    start_task(p,"W04")
    lookup(p,"W12")["status"]="blocked"

def cd_before_real_ai(p):
    start_task(p,"W09")
    assert lookup(p,"G5")["status"]=="not_run"
    assert lookup(p,"W07")["status"]=="planned"
    assert p["operations"]["postgresDeployment"]=="self_managed"

cases=[
("pass_without_evidence",lambda p:lookup(p,"AC01").update(status="pass"),False,"lacks evidence"),
("release_closure_cycle",lambda p:lookup(p,"F09")["criteria"].append("AC31"),False,"Release closure cycle"),
("release_open_issues",lambda p:pass_ac(p,"AC31"),False,"unresolved release-required issue"),
("work_mapping_missing",lambda p:lookup(p,"F08").update(works=["W02","W06"]),False,"omits criterion implementation work"),
("task_cycle",lambda p:lookup(p,"W01").update(dependsOn=["W10"]),False,"Mixed dependency cycle"),
("complete_without_ac",lambda p:lookup(p,"W01").update(status="complete"),False,"unpassed criterion"),
("gate_without_review",gate_without_review,False,"lacks evidence"),
("missing_review_path",missing_review,False,"Missing evidence file"),
("complete_bypasses_gate",bypass_gate_complete,False,"Required gate not passed"),
("start_bypasses_gate",bypass_gate_start,False,"Required gate not passed"),
("ci_finish_before_target_api",ci_finish_too_early,False,"Required task not complete"),
("cloud_without_operations_gate",cloud_without_operations_gate,False,"Required gate not passed"),
("operations_undecided",operations_undecided,False,"without PostgreSQL operations decision"),
("gate_without_owner_complete",gate_without_completed_owner,False,"Required task not complete"),
("closed_without_commit",closed_without_commit,False,"lacks resolved commit"),
("baseline_drift",lambda p:p["baseline"].update(commit="0"*40),False,"Baseline differs"),
("self_gate_cycle",lambda p:lookup(p,"W04")["requiredGates"].append("G3"),False,"Mixed dependency cycle"),
("unknown_persona",lambda p:p["personaReview"]["improvements"][0]["personas"].append("UNKNOWN"),False,"Unknown improvement persona"),
("persona_omits_work",lambda p:p["personaReview"]["improvements"][0].update(works=["W02","W05"]),False,"Improvement omits AC work"),
("criterion_text_drift",lambda p:lookup(p,"AC03").update(criterion="UNREVIEWED_CHANGE"),False,"AC text differs"),
("unchanged_plan",lambda p:None,True,None),
("local_development_external_wait",local_with_external_wait,True,None),
("ci_can_start_before_target_api",lambda p:start_task(p,"W11"),True,None),
("fixture_cd_before_real_ai_and_without_rds",cd_before_real_ai,True,None),
]
results=[]
for name,mutate,expected_ok,expected_error in cases:
    candidate=copy.deepcopy(base)
    mutate(candidate)
    captured={}
    def read(path,*args,**kwargs):
        if path.resolve()==manifest: return json.dumps(candidate,ensure_ascii=False)
        return read_original(path,*args,**kwargs)
    def write(path,value,*args,**kwargs):
        if path.resolve()!=report: raise AssertionError("Unexpected write: "+str(path))
        captured["result"]=json.loads(value)
        return len(value)
    try:
        Path.read_text,Path.write_text=read,write
        with redirect_stdout(io.StringIO()):
            try:
                runpy.run_path(str(ROOT/"verify_plan.py"),run_name="__main__")
            except SystemExit:
                pass
    finally:
        Path.read_text,Path.write_text=read_original,write_original
    actual=captured["result"]
    correct=actual["ok"]==expected_ok and (expected_error is None or any(expected_error in e for e in actual["errors"]))
    results.append({"case":name,"expectedAccepted":expected_ok,"passed":correct,
                    "expectedError":expected_error,"actualErrors":[] if correct else actual["errors"]})
output={"ok":all(x["passed"] for x in results),"cases":results,
        "negativeCases":sum(not x[2] for x in cases),"positiveCases":sum(x[2] for x in cases),
        "scope":"In-memory plan-state probes only; execution.json and service gates unchanged"}
(ROOT/"guardrail-check.json").write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(output,ensure_ascii=True,indent=2))
raise SystemExit(0 if output["ok"] else 1)

