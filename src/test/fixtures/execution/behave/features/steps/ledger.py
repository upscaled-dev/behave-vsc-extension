from pathlib import Path
from behave import given


@given('I record "{entry}"')
def record(context, entry):
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(entry + "\n")
    print("recorded " + entry)
    assert not (entry == "retry" and Path("fail-retry").exists()), "requested retry failure"
    if entry == "retry" and Path("wait-descendant").exists():
        import subprocess
        import sys
        child = subprocess.Popen([sys.executable, "-c", "import os,time; print('DESCENDANT_READY ' + str(os.getpid()), flush=True); time.sleep(600)"])
        Path("descendant.pid").write_text(str(child.pid))
        child.wait()
