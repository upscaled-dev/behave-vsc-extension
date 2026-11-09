from pathlib import Path

import pytest
from pytest_bdd import given, scenario


@pytest.mark.collection_case
@pytest.mark.parametrize("variant", ["alpha", "beta"], ids=["variant alpha", "variant::beta[]"])
@scenario("../features/catalog.feature", "Catalog line <value>")
def test_binding_is_unrelated(variant):
    pass


@given("a catalog entry")
def record(request, variant):
    if Path("wait-row").exists():
        import time
        print("COLLECTION_WAIT_READY", flush=True)
        time.sleep(600)
    if variant == "beta" and Path("skip-beta").exists():
        pytest.skip("requested beta skip")
    with Path("ledger.txt").open("a") as ledger:
        ledger.write(request.node.nodeid + "\n")
    if request.node.callspec.params["_pytest_bdd_example"]["value"] == "other" and variant == "beta" and Path("fail-other").exists():
        raise AssertionError("requested other row failure")


@pytest.fixture(autouse=True)
def phase_failures():
    if Path("setup-error").exists():
        raise RuntimeError("requested setup error")
    yield
    if Path("teardown-error").exists():
        raise RuntimeError("requested teardown error")
