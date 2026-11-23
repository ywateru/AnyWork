#!/usr/bin/env python3
"""Archive the exact CyberBus and EasyTier source used by AnyWork."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts/corresponding-source.tar.gz"
CACHE = ROOT / "artifacts/.corresponding-source-cache"
PINS = {
    "cyberbus": {
        "repository": "https://github.com/osd-pub/CyberBus.git",
        "commit": "a2b5be3b2c3cd8d21e6a0c5bf2b4da2040f36c11",
        "version": "v0.2.0",
    },
    "easytier": {
        "repository": "https://github.com/EasyTier/EasyTier.git",
        "commit": "0d9c52b169dc2112687ddefcf571cd01d383193c",
        "version": "v2.7.1",
    },
}


def git(checkout, *arguments, text=True):
    return subprocess.check_output(
        ["git", "-C", str(checkout), *arguments],
        text=text,
        stderr=subprocess.PIPE,
    )


def valid_checkout(path, commit):
    path = Path(path)
    if not path.is_dir() or not (path / ".git").exists():
        return False
    try:
        return git(path, "rev-parse", "HEAD").strip() == commit
    except subprocess.CalledProcessError:
        return False


def candidates(name, commit):
    yield CACHE / name
    cargo_home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    if name == "cyberbus":
        for checkout in sorted((cargo_home / "git/checkouts").glob("cyberbus-*/*")):
            yield checkout
    if name == "easytier":
        temporary = Path(os.environ.get("TMPDIR", tempfile.gettempdir()))
        for checkout in sorted(temporary.glob("easytier-build-*")):
            yield checkout


def fetch(name, pin, source):
    if source:
        if not valid_checkout(source, pin["commit"]):
            raise ValueError(
                f"{name} source must be a Git checkout at {pin['commit']}: {source}"
            )
        return Path(source)
    for checkout in candidates(name, pin["commit"]):
        if valid_checkout(checkout, pin["commit"]):
            return checkout
    destination = CACHE / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not (destination / ".git").exists():
        if destination.exists():
            shutil.rmtree(destination)
        subprocess.run(
            [
                "git",
                "clone",
                "--filter=blob:none",
                "--no-checkout",
                pin["repository"],
                str(destination),
            ],
            check=True,
        )
    try:
        git(destination, "fetch", "--depth=1", "origin", pin["commit"])
    except subprocess.CalledProcessError:
        git(destination, "fetch", "origin")
    git(destination, "checkout", "--detach", pin["commit"])
    if not valid_checkout(destination, pin["commit"]):
        raise ValueError(f"Fetched {name} source has the wrong revision")
    return destination


def tracked_files(checkout, commit):
    raw = git(checkout, "ls-tree", "-rz", "--full-tree", commit, text=False)
    files = []
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        metadata, name_bytes = entry.split(b"\t", 1)
        mode, kind, object_id = metadata.decode("ascii").split(" ")
        if kind != "blob" or mode not in ("100644", "100755", "120000"):
            raise ValueError(f"{checkout} contains an unsupported Git entry")
        name = name_bytes.decode("utf-8")
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name:
            raise ValueError(f"{checkout} contains an unsafe Git path")
        if mode == "120000":
            target = git(
                checkout, "cat-file", "blob", object_id
            ).strip()
            resolved = posixpath.normpath(
                posixpath.join(posixpath.dirname(name), target)
            )
            if (
                not target
                or target.startswith("/")
                or resolved == ".."
                or resolved.startswith("../")
            ):
                raise ValueError(f"{checkout} contains an unsafe Git symlink")
            files.append((name, target, mode))
            continue
        files.append((name, object_id, int(mode, 8) & 0o777))
    return sorted(files)


def archive_file(archive, name, content, mode=0o644):
    info = tarfile.TarInfo(name)
    info.size = len(content)
    info.mode = mode
    info.mtime = 0
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    archive.addfile(info, io.BytesIO(content))


def archive_symlink(archive, name, target):
    info = tarfile.TarInfo(name)
    info.type = tarfile.SYMTYPE
    info.linkname = target
    info.size = 0
    info.mode = 0o777
    info.mtime = 0
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    archive.addfile(info)


def build(cyberbus_source, easytier_source, pins, output):
    checkouts = {
        name: fetch(name, pin, source)
        for name, pin, source in (
            ("cyberbus", pins["cyberbus"], cyberbus_source),
            ("easytier", pins["easytier"], easytier_source),
        )
    }
    files = {
        name: tracked_files(checkout, pins[name]["commit"])
        for name, checkout in checkouts.items()
    }
    metadata = {
        "format": 1,
        "purpose": "Corresponding source for CyberBus/EasyTier LGPL components",
        "components": {
            name: {
                **pins[name],
                "files": len(files[name]),
                "license": (
                    "MIT OR Apache-2.0; cyberbus-transport is LGPL-3.0-or-later"
                    if name == "cyberbus"
                    else "LGPL-3.0"
                ),
            }
            for name in pins
        },
    }
    readme = """AnyWork corresponding source for CyberBus and EasyTier

This archive contains the exact tracked source revisions used by AnyWork.
It is not a replacement for the AnyWork source archive.

CyberBus v0.2.0
  commit: a2b5be3b2c3cd8d21e6a0c5bf2b4da2040f36c11
  repository: https://github.com/osd-pub/CyberBus.git
  license: MIT OR Apache-2.0; cyberbus-transport is LGPL-3.0-or-later

EasyTier v2.7.1
  commit: 0d9c52b169dc2112687ddefcf571cd01d383193c
  repository: https://github.com/EasyTier/EasyTier.git
  license: LGPL-3.0

Build the native CyberBus transport:
  cd cyberbus
  cargo build --locked -p cyberbus-transport

Build the browser overlay:
  Use the EasyTier checkout above with scripts/build-easytier-browser.sh
  from the AnyWork source archive. The script records the exact commands,
  Rust toolchain, pnpm and esbuild versions.

Relink a modified LGPL component:
  See cyberbus/packaging/RELINK.md. AnyWork's source archive contains its
  build scripts and application source. The CyberBus archive includes the
  C/JNI/Apple/Android SDK build and replacement instructions.

The source archives are offered to satisfy the GNU LGPL corresponding-source
and relinking requirements. Do not remove this README, the license texts, or
the upstream packaging instructions when redistributing AnyWork.
"""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output.parent, suffix=".tmp", delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with temporary_path.open("wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w") as archive:
                    archive_file(
                        archive,
                        "corresponding-source/CORRESPONDING_SOURCE.json",
                        (json.dumps(metadata, indent=2) + "\n").encode(),
                    )
                    archive_file(
                        archive,
                        "corresponding-source/README.txt",
                        readme.encode(),
                    )
                    for name in ("cyberbus", "easytier"):
                        for path, value, mode in files[name]:
                            if mode == "120000":
                                archive_symlink(
                                    archive,
                                    f"corresponding-source/{name}/{path}",
                                    value,
                                )
                                continue
                            content = git(
                                checkouts[name],
                                "cat-file",
                                "blob",
                                value,
                                text=False,
                            )
                            archive_file(
                                archive,
                                f"corresponding-source/{name}/{path}",
                                content,
                                mode,
                            )
        digest = hashlib.sha256(temporary_path.read_bytes()).hexdigest()
        temporary_path.chmod(0o644)
        temporary_path.replace(output)
    finally:
        temporary_path.unlink(missing_ok=True)
    Path(str(output) + ".sha256").write_text(
        f"{digest}  {output.name}\n", encoding="utf-8"
    )
    print(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cyberbus-source", type=Path)
    parser.add_argument("--easytier-source", type=Path)
    parser.add_argument(
        "--cyberbus-commit", default=PINS["cyberbus"]["commit"]
    )
    parser.add_argument(
        "--easytier-commit", default=PINS["easytier"]["commit"]
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    for value in (args.cyberbus_commit, args.easytier_commit):
        if not re.fullmatch(r"[0-9a-f]{40}", value):
            parser.error("source commits must be complete lowercase SHA-1 values")
    pins = {
        "cyberbus": {**PINS["cyberbus"], "commit": args.cyberbus_commit},
        "easytier": {**PINS["easytier"], "commit": args.easytier_commit},
    }
    build(args.cyberbus_source, args.easytier_source, pins, args.output)


if __name__ == "__main__":
    main()
