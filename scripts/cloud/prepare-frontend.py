#!/usr/bin/env python3
"""Bind the Vercel CSP to the complete public CyberBus Web configuration.

No cloud APIs or credentials are read. All six VITE account values are explicit
at deployment time. The generated policy is checked again by
scripts/assemble-vercel.py before the prebuilt output is accepted.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]
KEYS = (
    'VITE_LOGTO_ENDPOINT',
    'VITE_LOGTO_APP_ID',
    'VITE_LOGTO_RESOURCE',
    'VITE_CYBERBUS_PRODUCT_ID',
    'VITE_CYBERBUS_BOOTSTRAP_PEERS',
    'VITE_CYBERBUS_EASYTIER_URL',
)


class ConfigurationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ConfigurationError(message)


def exact_origin(value):
    parsed = urllib.parse.urlsplit(value)
    require(
        parsed.scheme == 'https'
        and parsed.hostname
        and not parsed.username
        and not getattr(parsed, 'pass' + 'word')
        and parsed.path in ('', '/')
        and not parsed.query
        and not parsed.fragment
        and '*' not in parsed.netloc,
        'Expected a credential-free HTTPS origin',
    )
    require(
        re.fullmatch(r'[A-Za-z0-9.:[\]-]+', parsed.netloc),
        'Expected a plain HTTPS origin',
    )
    return parsed.scheme + '://' + parsed.netloc


def exact_resource(value):
    parsed = urllib.parse.urlsplit(value)
    require(
        parsed.scheme == 'https'
        and parsed.hostname
        and not parsed.username
        and not getattr(parsed, 'pass' + 'word')
        and not parsed.query
        and not parsed.fragment
        and '*' not in parsed.netloc,
        'Expected a credential-free HTTPS resource',
    )
    require(
        re.fullmatch(r'[A-Za-z0-9.:[\]-]+', parsed.netloc),
        'Expected a plain HTTPS resource',
    )
    return urllib.parse.urlunsplit(parsed)


def relay_origins(value):
    peers = [item.strip() for item in value.split(',') if item.strip()]
    require(0 < len(peers) <= 64, 'Expected 1-64 CyberBus relay peers')
    origins = []
    for peer in peers:
        parsed = urllib.parse.urlsplit(peer)
        loopback = parsed.hostname in ('127.0.0.1', '::1', 'localhost')
        require(
            parsed.hostname
            and not parsed.username
            and not getattr(parsed, 'pass' + 'word')
            and not parsed.query
            and not parsed.fragment
            and (parsed.scheme == 'wss' or (parsed.scheme == 'ws' and loopback)),
            'CyberBus relay peers must use wss, or ws only on loopback',
        )
        require(
            re.fullmatch(r'[A-Za-z0-9.:[\]-]+', parsed.netloc),
            'Expected a plain CyberBus relay origin',
        )
        origins.append(
            ('ws://' if parsed.scheme == 'ws' else 'wss://') + parsed.netloc
        )
    return origins


def validate(values):
    require(
        all(isinstance(values.get(key), str) and values[key] for key in KEYS),
        'All six public account configuration fields are required',
    )
    result = {key: values[key] for key in KEYS}
    require(
        not any(character.isspace() for value in result.values() for character in value),
        'Public account configuration cannot contain whitespace',
    )
    endpoint = exact_origin(result['VITE_LOGTO_ENDPOINT'])
    resource = exact_resource(result['VITE_LOGTO_RESOURCE'])
    require(
        re.fullmatch(r'[A-Za-z0-9_-]{1,21}', result['VITE_LOGTO_APP_ID']),
        'Invalid public Logto application ID',
    )
    require(
        re.fullmatch(r'[A-Za-z0-9_-]{1,64}', result['VITE_CYBERBUS_PRODUCT_ID']),
        'Invalid CyberBus product ID',
    )
    require(
        re.fullmatch(r'/[A-Za-z0-9_./-]+\.js', result['VITE_CYBERBUS_EASYTIER_URL'])
        and '..' not in result['VITE_CYBERBUS_EASYTIER_URL'].split('/'),
        'EasyTier browser module must be a local .js path',
    )
    peers = relay_origins(result['VITE_CYBERBUS_BOOTSTRAP_PEERS'])
    return endpoint, resource, peers


def policy(values):
    endpoint, resource, peers = validate(values)
    resource_origin = 'https://' + urllib.parse.urlsplit(resource).netloc
    connections = ' '.join(
        dict.fromkeys(["'self'", 'https://api.github.com', endpoint, resource_origin, *peers])
    )
    return (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; font-src 'self' data:; "
        f"connect-src {connections}; "
        "worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; "
        f"base-uri 'self'; form-action 'self' {endpoint}"
    )


def bind(config, values, check=False):
    expected = policy(values)
    headers = [
        item
        for rule in config.get('headers', [])
        if rule.get('source') == '/(.*)'
        for item in rule.get('headers', [])
        if item.get('key', '').lower() == 'content-security-policy'
    ]
    require(len(headers) == 1, 'Expected exactly one global Vercel CSP header')
    if check:
        require(
            headers[0].get('value') == expected,
            'Vercel CSP differs from frontend configuration; '
            'run scripts/cloud/prepare-frontend.py before vercel build',
        )
    else:
        headers[0]['value'] = expected
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Refuse a stale CSP')
    args = parser.parse_args()
    path = ROOT / 'vercel.json'
    config = bind(json.loads(path.read_text()), os.environ, args.check)
    if not args.check:
        path.write_text(json.dumps(config, indent=2) + '\n')
    print('Verified complete public CyberBus configuration and matching Vercel CSP')


if __name__ == '__main__':
    try:
        main()
    except (ConfigurationError, ValueError, OSError):
        print(
            'Frontend deployment configuration rejected; check the complete '
            'public CyberBus configuration and Vercel CSP.',
            file=sys.stderr,
        )
        raise SystemExit(1)
