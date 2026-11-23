#!/usr/bin/env python3
"""Verify corresponding-source archive construction without network access."""
import hashlib
import pathlib
import subprocess
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class CorrespondingSource(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="anywork-corresponding-source-"
        )
        self.root = pathlib.Path(self.temporary.name)
        self.repositories = {}
        for name in ("cyberbus", "easytier"):
            repository = self.root / name
            repository.mkdir()
            subprocess.run(["git", "init", "-q", str(repository)], check=True)
            (repository / "LICENSE").write_text(name + " license\n")
            source = repository / "src"
            source.mkdir()
            (source / "main.rs").write_text("fn main() {}\n")
            (repository / "COPYING").write_text(name + " copying\n")
            (source / "LICENSE").symlink_to("../COPYING")
            subprocess.run(
                ["git", "-C", str(repository), "add", "."], check=True
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(repository),
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "-qm",
                    "source",
                ],
                check=True,
            )
            self.repositories[name] = (
                repository,
                subprocess.check_output(
                    ["git", "-C", str(repository), "rev-parse", "HEAD"],
                    text=True,
                ).strip(),
            )

    def tearDown(self):
        self.temporary.cleanup()

    def export(self, output, **overrides):
        command = [
            "python3",
            str(ROOT / "scripts/corresponding-source.py"),
            "--cyberbus-source",
            str(self.repositories["cyberbus"][0]),
            "--easytier-source",
            str(self.repositories["easytier"][0]),
            "--cyberbus-commit",
            self.repositories["cyberbus"][1],
            "--easytier-commit",
            self.repositories["easytier"][1],
            "--output",
            str(output),
        ]
        command.extend(overrides.get("arguments", []))
        return subprocess.run(command, capture_output=True, text=True)

    def test_archives_both_exact_checkouts_with_neutral_metadata(self):
        output = self.root / "artifacts/corresponding-source.tar.gz"
        result = self.export(output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(output.is_file())
        self.assertEqual(
            pathlib.Path(str(output) + ".sha256").read_text().split()[0],
            hashlib.sha256(output.read_bytes()).hexdigest(),
        )
        with tarfile.open(output) as archive:
            names = set(archive.getnames())
            self.assertIn(
                "corresponding-source/README.txt", names
            )
            self.assertIn(
                "corresponding-source/cyberbus/LICENSE", names
            )
            self.assertIn(
                "corresponding-source/easytier/src/main.rs", names
            )
            self.assertIn(
                "corresponding-source/cyberbus/src/LICENSE", names
            )
            self.assertTrue(
                archive.getmember(
                    "corresponding-source/cyberbus/src/LICENSE"
                ).issym()
            )
            self.assertFalse(any("/.git/" in name for name in names))
            self.assertTrue(
                all(
                    member.uid == member.gid == 0
                    and not member.uname
                    and not member.gname
                    for member in archive
                )
            )

    def test_wrong_revision_fails_without_publishing_archive(self):
        output = self.root / "artifacts/corresponding-source.tar.gz"
        result = self.export(
            output,
            arguments=[
                "--cyberbus-commit",
                "0" * 40,
            ],
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
