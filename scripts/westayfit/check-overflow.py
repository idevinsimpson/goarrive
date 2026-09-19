#!/usr/bin/env python3
"""Read a capture run's overflow.json and say, correctly, whether it is clean.

This exists because a hand-written check read the file's TOP-LEVEL keys instead
of each state's nested `results` array, so every state passed trivially and a
real 195 px offender was reported to the owner as zero. The rule here is that a
result must be PROVEN good: anything missing, empty or malformed is a failure,
never a silent pass, and the expected widths must actually be present.

  check-overflow.py <overflow.json> [--expect-widths 360,195] [--expect-states N]
  check-overflow.py --self-test
"""
import json
import sys

REQUIRED_RESULT_KEYS = ("width", "scrollWidth", "ok", "offenders")


def audit(doc, expect_widths=(360, 195), expect_states=None):
    """Return (problems, checks_total, checks_failed, states_seen)."""
    problems, checks_total, checks_failed = [], 0, 0

    if not isinstance(doc, list):
        return [f"overflow.json is {type(doc).__name__}, expected a list"], 0, 0, 0
    if not doc:
        return ["overflow.json is an empty list: nothing was measured"], 0, 0, 0

    for i, state in enumerate(doc):
        label = f"entry {i}"
        if not isinstance(state, dict):
            problems.append(f"{label}: expected an object, got {type(state).__name__}")
            continue
        name = state.get("name")
        label = name or label
        if not name:
            problems.append(f"{label}: no `name`")

        results = state.get("results")
        if results is None:
            problems.append(f"{label}: no `results` array (this is the bug that produced a false green)")
            continue
        if not isinstance(results, list) or not results:
            problems.append(f"{label}: `results` is empty or not a list")
            continue

        widths_seen = []
        for r in results:
            if not isinstance(r, dict):
                problems.append(f"{label}: a result is {type(r).__name__}, expected an object")
                continue
            missing = [k for k in REQUIRED_RESULT_KEYS if k not in r]
            if missing:
                problems.append(f"{label}: result missing {', '.join(missing)}")
                continue
            if not isinstance(r["ok"], bool):
                problems.append(f"{label} @ {r['width']}: `ok` is {type(r['ok']).__name__}, expected a boolean")
                continue
            if not isinstance(r["offenders"], list):
                problems.append(f"{label} @ {r['width']}: `offenders` is not a list")
                continue

            widths_seen.append(r["width"])
            checks_total += 1
            # Both signals must agree; an `ok: true` carrying offenders is itself a defect.
            if not r["ok"] or r["offenders"]:
                checks_failed += 1
                for off in (r["offenders"] or ["(ok=false with no offender listed)"]):
                    problems.append(f"OVERFLOW  {label} @ {r['width']} px: {off}")

        for w in expect_widths:
            if w not in widths_seen:
                problems.append(f"{label}: no result at {w} px (expected {list(expect_widths)})")

    if expect_states is not None and len(doc) != expect_states:
        problems.append(f"expected {expect_states} states, found {len(doc)}")

    return problems, checks_total, checks_failed, len(doc)


def self_test():
    """The reader must catch what the old check missed."""
    good = [{"name": "a", "results": [{"width": 360, "scrollWidth": 360, "ok": True, "offenders": []},
                                      {"width": 195, "scrollWidth": 195, "ok": True, "offenders": []}]}]
    cases = [
        ("clean run passes", good, True),
        ("NESTED FAILING WIDTH IS CAUGHT (the regression for the false green)",
         [{"name": "a", "results": [{"width": 360, "scrollWidth": 360, "ok": True, "offenders": []},
                                    {"width": 195, "scrollWidth": 225, "ok": False,
                                     "offenders": ["wsf-community-reset-confirm-yes@225"]}]}], False),
        ("ok:true carrying offenders is caught",
         [{"name": "a", "results": [{"width": 360, "scrollWidth": 360, "ok": True, "offenders": ["x@400"]},
                                    {"width": 195, "scrollWidth": 195, "ok": True, "offenders": []}]}], False),
        ("missing results array is caught", [{"name": "a"}], False),
        ("empty results array is caught", [{"name": "a", "results": []}], False),
        ("missing expected width is caught",
         [{"name": "a", "results": [{"width": 360, "scrollWidth": 360, "ok": True, "offenders": []}]}], False),
        ("malformed result object is caught",
         [{"name": "a", "results": [{"width": 360, "ok": True}]}], False),
        ("empty document is caught", [], False),
        ("wrong top-level type is caught", {"name": "a"}, False),
        ("state-count mismatch is caught", good, False),
    ]
    failures = 0
    for i, (label, doc, should_pass) in enumerate(cases):
        expect_states = 2 if label.startswith("state-count") else None
        problems, total, failed, states = audit(doc, expect_states=expect_states)
        passed = not problems
        ok = passed is should_pass
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}"
              f"   (checks={total}, failed={failed}, problems={len(problems)})")
        if not ok:
            failures += 1
    print(f"\nself-test: {len(cases) - failures}/{len(cases)} passed")
    return 1 if failures else 0


def main():
    if "--self-test" in sys.argv:
        return self_test()
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    widths = (360, 195)
    expect_states = None
    if "--expect-widths" in sys.argv:
        widths = tuple(int(x) for x in sys.argv[sys.argv.index("--expect-widths") + 1].split(","))
    if "--expect-states" in sys.argv:
        expect_states = int(sys.argv[sys.argv.index("--expect-states") + 1])

    with open(path) as fh:
        doc = json.load(fh)
    problems, total, failed, states = audit(doc, widths, expect_states)

    print(f"states inspected : {states}")
    print(f"width checks     : {total}   (the denominator)")
    print(f"width checks failed: {failed}")
    print(f"problems         : {len(problems)}")
    for p in problems:
        print(f"  - {p}")
    print("RESULT: " + ("CLEAN" if not problems else "NOT CLEAN"))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
