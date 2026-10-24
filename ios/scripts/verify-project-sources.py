#!/usr/bin/env python3
"""Check generated PBXSourcesBuildPhase membership, not Swift source text.

Swift's compiler (in the subsequent build) is the authority for duplicate types.
This check catches omitted/duplicate file references before compilation.
"""
import json
from pathlib import Path
import sys


def verify(project, ios_root):
    objects = project["objects"]
    parents = {}
    for key, obj in objects.items():
        if obj.get("isa") == "PBXGroup":
            for child in obj.get("children", []):
                parents[child] = key

    def resolve(key):
        obj = objects[key]
        path = Path(obj.get("path", ""))
        tree = obj.get("sourceTree", "<group>")
        if tree == "SOURCE_ROOT":
            return (ios_root / path).resolve()
        if tree == "<absolute>":
            return path.resolve()
        if tree != "<group>":
            raise ValueError(f"Unsupported source tree: {tree}")
        base = resolve(parents[key]) if key in parents else ios_root
        return (base / path).resolve()

    for name in ("TalkHint", "TalkHintTests"):
        targets = [o for o in objects.values()
                   if o.get("isa") == "PBXNativeTarget" and o.get("name") == name]
        if len(targets) != 1:
            raise ValueError(f"Expected exactly one {name} target")
        actual = []
        for phase_id in targets[0]["buildPhases"]:
            phase = objects[phase_id]
            if phase.get("isa") == "PBXSourcesBuildPhase":
                for build_id in phase.get("files", []):
                    ref = objects[build_id]["fileRef"]
                    if objects[ref].get("path", "").endswith(".swift"):
                        actual.append(resolve(ref))
        if len(actual) != len(set(actual)):
            raise ValueError(f"{name}: duplicate Swift Compile Sources entries")
        expected = {p.resolve() for p in (ios_root / name).rglob("*.swift")}
        if not expected:
            raise ValueError(f"{name}: no Swift sources on disk")
        if expected != set(actual):
            missing = sorted(str(p) for p in expected - set(actual))
            extra = sorted(str(p) for p in set(actual) - expected)
            raise ValueError(f"{name}: missing={missing}, unexpected={extra}")
        print(f"{name}: all {len(expected)} Swift files included exactly once")


if __name__ == "__main__":
    verify(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]).resolve())
