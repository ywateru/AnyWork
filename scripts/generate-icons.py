#!/usr/bin/env python3
"""Compatibility entry point; all platform icons come from the canonical SVG."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]

if __name__ == '__main__':
    subprocess.run(['node', 'scripts/build-icons.mjs'], cwd=ROOT, check=True)
