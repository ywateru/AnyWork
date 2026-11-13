#!/usr/bin/env python3
"""Verify complete vendoring against an extracted, fixed-revision upstream tree."""
import difflib
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
upstream = Path(sys.argv[1])
manifest = json.loads((root / "SOURCE.json").read_text())
entries = manifest["files"]
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
sources = {
    str(path.relative_to(upstream))
    for path in (upstream / "kotlin-sdk/kotlin/src/main/kotlin").rglob("*")
    if path.is_file()
}
assert sources == {e["upstream"] for e in entries if e["local"].startswith("src/")}
assert {str(p.relative_to(root)) for p in (root / "src/main/kotlin").rglob("*") if p.is_file()} == {
    e["local"] for e in entries if e["local"].startswith("src/")
}
patch = ""
changed = []
for entry in entries:
    original, local = upstream / entry["upstream"], root / entry["local"]
    assert digest(original) == entry["upstream_sha256"], entry["upstream"]
    assert digest(local) == entry["local_sha256"], entry["local"]
    if original.read_bytes() != local.read_bytes():
        changed.append(entry["local"])
        patch += "".join(difflib.unified_diff(
            original.read_text().splitlines(True), local.read_text().splitlines(True),
            fromfile="a/" + entry["local"], tofile="b/" + entry["local"],
        ))
assert changed == ["src/main/kotlin/io/logto/sdk/core/http/HttpRequest.kt"], changed
assert patch == (root / "source.patch").read_text()
print(f"Verified {len(sources)} complete Kotlin sources, license/catalog/build hashes, and exact HTTP-only patch")
