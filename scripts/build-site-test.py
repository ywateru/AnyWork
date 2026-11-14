#!/usr/bin/env python3
"""Offline static Android download contract, including no-JavaScript output."""
import contextlib
import html.parser
import importlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

builder = importlib.import_module('build-site')
SPLIT = [f'anywork-android-{abi}.apk' for abi in ('arm64', 'armv7', 'x86', 'x86_64')]


class AndroidLinks(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.tag = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'body':
            self.tag = attrs.get('data-release-version')
        if tag == 'a' and attrs.get('data-asset', '').startswith('anywork-android'):
            self.links.append((attrs['data-asset'], attrs['href']))


class StaticDownloads(unittest.TestCase):
    def test_old_and_split_releases_render_exact_real_links_in_each_language(self):
        for tag in ('v0.1.13', 'v0.1.34', 'v0.1.35', 'v0.1.100', 'v1.0.0'):
            names = ['anywork-android.apk'] if tag in ('v0.1.13', 'v0.1.34') else SPLIT
            base = builder.REPO + '/releases/download/' + tag + '/'
            data = {'tag_name': tag, 'assets': [{'name': name, 'size': 100, 'browser_download_url': base + name} for name in names]}
            with self.subTest(tag=tag), tempfile.TemporaryDirectory() as directory:
                dist = Path(directory) / 'dist'
                with mock.patch.object(builder, 'DIST', dist), mock.patch.object(builder.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(data).encode())), mock.patch('sys.argv', ['build-site.py', '--fetch-release']), contextlib.redirect_stdout(io.StringIO()):
                    builder.main()
                for language in ('en', 'zh', ''):
                    parser = AndroidLinks()
                    parser.feed((dist / language / 'index.html').read_text())
                    self.assertEqual(parser.tag, tag)
                    self.assertEqual(parser.links, [(name, base + name) for name in names])
                self.assertEqual(json.loads((dist / 'release.json').read_text()), data)

    def test_no_release_uses_four_release_list_links_and_no_fake_asset_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory) / 'dist'
            with mock.patch.object(builder, 'DIST', dist), mock.patch('sys.argv', ['build-site.py']), contextlib.redirect_stdout(io.StringIO()):
                builder.main()
            parser = AndroidLinks()
            parser.feed((dist / 'en/index.html').read_text())
            self.assertEqual(parser.links, [(name, builder.REPO + '/releases') for name in SPLIT])

    def test_wrong_android_sets_fail_before_replacing_existing_site(self):
        for tag, names in [('v0.1.35', SPLIT[:-1]),
                           ('v0.1.35', SPLIT + ['anywork-android.apk']),
                           ('v0.1.35', SPLIT + ['anywork-android-universal.apk']),
                           ('v0.1.35', SPLIT[:-1] + [SPLIT[0]]),
                           ('v0.1.34', SPLIT)]:
            with self.subTest(tag=tag, names=names), tempfile.TemporaryDirectory() as directory:
                dist = Path(directory)
                (dist / 'keep').write_text('previous valid output')
                data = {'tag_name': tag, 'assets': [{'name': name, 'size': 100, 'browser_download_url': builder.REPO + '/releases'} for name in names]}
                with mock.patch.object(builder, 'DIST', dist), mock.patch.object(builder.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(data).encode())), mock.patch('sys.argv', ['build-site.py', '--fetch-release']):
                    with self.assertRaisesRegex(ValueError, 'versioned release contract'):
                        builder.main()
                self.assertEqual((dist / 'keep').read_text(), 'previous valid output')

    def test_download_url_is_bound_to_the_exact_release_and_architecture(self):
        for url in ['https://elsewhere.invalid/anywork-android-arm64.apk',
                    builder.REPO + '/releases/download/v0.1.34/anywork-android.apk',
                    builder.REPO + '/releases/download/v0.1.35/anywork-android-x86.apk']:
            assets = [{'name': name, 'browser_download_url': builder.REPO + '/releases/download/v0.1.35/' + name} for name in SPLIT]
            assets[0]['browser_download_url'] = url
            with self.assertRaisesRegex(ValueError, 'URL differs from the release tag'):
                builder.android_names({'tag_name': 'v0.1.35', 'assets': assets})


if __name__ == '__main__':
    unittest.main()
