"""Negative probes for document guardrails. Does not change execution.json or archive."""
from pathlib import Path
from contextlib import redirect_stdout
import copy
import io
import json
import runpy

ROOT = Path(__file__).resolve().parent
manifest = ROOT / "execution.json"
report = ROOT / "document-check.json"
base = json.loads(manifest.read_text(encoding="utf-8"))
read_original, write_original = Path.read_text, Path.write_text
probes = [
    ("pass_without_evidence", lambda p: p["criteria"][0].update(status="pass"), "Pass without evidence"),
    ("release_closure_cycle", lambda p: p["issues"][8]["criteria"].append("AC31"), "Release closure cycle"),
    ("release_with_open_issues", lambda p: p["criteria"][30].update(status="pass", evidencePaths=["records/README.md"]), "unresolved release-required issue"),
    ("missing_implementation_work", lambda p: p["issues"][7].update(works=["W02", "W06"]), "omits criterion implementation work"),
    ("task_dependency_cycle", lambda p: p["tasks"][0].update(dependsOn=["W10"]), "dependency cycle"),
    ("complete_without_acceptance", lambda p: p["tasks"][0].update(status="complete"), "unpassed criterion"),
    ("gate_without_review", lambda p: p["gates"][0].update(status="pass"), "lacks review evidence"),
]
results = []
for name, mutate, expected in probes:
    candidate = copy.deepcopy(base)
    mutate(candidate)
    captured = {}
    def fake_read(path, *args, **kwargs):
        if path.resolve() == manifest.resolve():
            return json.dumps(candidate, ensure_ascii=False)
        return read_original(path, *args, **kwargs)
    def fake_write(path, data, *args, **kwargs):
        if path.resolve() == report.resolve():
            captured["report"] = json.loads(data)
            return len(data)
        raise AssertionError("Unexpected write during guardrail probe: " + str(path))
    code = None
    try:
        Path.read_text, Path.write_text = fake_read, fake_write
        with redirect_stdout(io.StringIO()):
            try:
                runpy.run_path(str(ROOT / "verify_plan.py"), run_name="__main__")
            except SystemExit as exc:
                code = exc.code
    finally:
        Path.read_text, Path.write_text = read_original, write_original
    errors = captured.get("report", {}).get("errors", [])
    rejected = code == 1 and any(expected in err for err in errors)
    results.append({"probe": name, "correctlyRejected": rejected, "expectedError": expected})
output = {"ok": all(r["correctlyRejected"] for r in results), "probes": results,
          "scope": "Document validator negative probes only. No service execution."}
(ROOT / "guardrail-check.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(output, ensure_ascii=False, indent=2))
raise SystemExit(0 if output["ok"] else 1)

