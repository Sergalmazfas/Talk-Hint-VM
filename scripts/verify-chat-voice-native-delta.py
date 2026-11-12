#!/usr/bin/env python3
"""Read-only Git/source audit. Never invokes Xcode, an API provider or a server."""
import argparse
import ast
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/chat-voice-native-delta.json"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def blob(ref, path):
    return git("show", f"{ref}:{path}")


def inventory(ref):
    result = {}
    paths = git("ls-tree", "-r", "--name-only", ref, "--", "ios/TalkHintTests").decode().splitlines()
    for path in paths:
        if path.endswith(".swift"):
            methods = set(re.findall(rb"\bfunc\s+(test\w+)\s*\(", blob(ref, path)))
            if methods:
                result[path] = methods
    return result


def required(ref):
    module = ast.parse(blob(ref, "ios/scripts/verify-xcresult.py"))
    return next(ast.literal_eval(node.value) for node in module.body
                if isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "REQUIRED_TESTS" for t in node.targets))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", help="Audit Git objects only, not a checked-out/built app")
    args = parser.parse_args()
    meta = json.loads(MANIFEST.read_text())
    base, ref = meta["mac_base"], args.ref or "HEAD"
    assert git("rev-parse", f"{ref}:ios").decode().strip() == meta["native_tree"], "Unexpected native tree"
    subprocess.run(["git", "merge-base", "--is-ancestor", base, ref], cwd=ROOT, check=True)
    assert git("diff", "--name-only", base, ref, "--", ".github/workflows").strip() == b"", "CI changed"
    changed = git("diff", "--name-only", base, ref).decode().splitlines()
    permitted = set(meta["permitted_support_paths"])
    assert all(p.startswith("ios/") or p in permitted for p in changed), "Unapproved non-native change"
    for path in meta["protected_native_paths"]:
        assert blob(base, path) == blob(ref, path), f"Mac baseline overwritten: {path}"
    scene_path = "ios/TalkHint/App/SceneDelegate.swift"
    def root_entry(raw):
        return raw.split(b"    func showRoot(loggedIn: Bool)", 1)[1].split(b"\n    }\n", 1)[0]
    assert root_entry(blob(base, scene_path)) == root_entry(blob(ref, scene_path)), "Strict login entry changed"
    old_tests, new_tests = inventory(base), inventory(ref)
    for path, methods in old_tests.items():
        assert methods <= new_tests.get(path, set()), f"Accepted Mac test removed: {path}"
    old_required, new_required = required(base), required(ref)
    for suite, methods in old_required.items():
        assert set(methods) <= set(new_required.get(suite, ())), f"Mac gate weakened: {suite}"
    for path, methods in new_tests.items():
        if Path(path).stem.startswith("ChatVoice"):
            names = {m.decode() for m in methods}
            assert names == set(new_required.get(Path(path).stem, ())), f"Missing voice gate: {path}"
    for lang in ("en", "es", "ru", "kk", "uk"):
        path = f"ios/TalkHint/Resources/{lang}.lproj/Localizable.strings"
        keys = lambda raw: set(re.findall(rb'^"([^"]+)"\s*=', raw, re.M))
        assert keys(blob(base, path)) <= keys(blob(ref, path)), f"Lost localized keys: {lang}"
    if args.ref is None:
        dirty = git("status", "--porcelain", "--untracked-files=no").decode().strip()
        assert not dirty, "Tracked checkout modified; stop, do not reset/stash/clean"
        for path in git("ls-tree", "-r", "--name-only", ref, "--", "ios").decode().splitlines():
            assert (ROOT / path).read_bytes() == blob(ref, path), f"Checkout differs: {path}"
    print(json.dumps({
        "audit": "git_objects_only" if args.ref else "git_and_checkout",
        "base": base, "ref": git("rev-parse", ref).decode().strip(),
        "changed_native_paths": sum(p.startswith("ios/") for p in changed),
        "baseline_test_methods_preserved": sum(map(len, old_tests.values())),
        "required_native_successes": sum(map(len, new_required.values())),
        "native_build_performed": False,
        "paid_requests_performed": False,
    }, indent=2))


if __name__ == "__main__":
    main()
