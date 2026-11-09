#!/usr/bin/env python3
"""Bind Vercel's CSP to complete public frontend configuration before prebuilding.

No cloud APIs or credentials are read. The five VITE account values must be
explicit at deployment time, even when the interactive client has DEV defaults.
"""
import argparse
import json
import os
from pathlib import Path
import sys

from configure import ConfigurationError, require, validate_public_config

ROOT = Path(__file__).resolve().parents[2]


def policy(values):
    public = validate_public_config(values)
    endpoint, grid = public['VITE_LOGTO_ENDPOINT'], public['VITE_CYBERGRID_URL']
    connections = ' '.join(dict.fromkeys(["'self'", 'https://api.github.com', endpoint, grid,
                                        'wss://*.trycloudflare.com']))
    return ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self' data:; connect-src " + connections
            + "; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; "
            "base-uri 'self'; form-action 'self' " + endpoint)


def bind(config, values, check=False):
    expected = policy(values)
    headers = [item for rule in config.get('headers', []) if rule.get('source') == '/(.*)'
               for item in rule.get('headers', []) if item.get('key', '').lower() == 'content-security-policy']
    require(len(headers) == 1, 'Expected exactly one global Vercel CSP header')
    if check:
        require(headers[0].get('value') == expected,
                'Vercel CSP differs from frontend configuration; run scripts/cloud/prepare-frontend.py before vercel build')
    else:
        headers[0]['value'] = expected
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Refuse a stale CSP instead of updating it')
    args = parser.parse_args()
    path = ROOT / 'vercel.json'
    config = bind(json.loads(path.read_text()), os.environ, args.check)
    if not args.check:
        path.write_text(json.dumps(config, indent=2) + '\n')
    print('Verified complete public frontend configuration and matching Vercel CSP')


if __name__ == '__main__':
    try:
        main()
    except (ConfigurationError, ValueError, OSError):
        print('Frontend deployment configuration rejected; check the complete public configuration and Vercel CSP.', file=sys.stderr)
        raise SystemExit(1)
