#!/usr/bin/env python3
"""Build deterministic, dependency-free bilingual GitHub Pages output."""
import argparse
import html
import json
import os
import pathlib
import shutil
from string import Template
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
DIST = SITE / 'dist'
REPO = 'https://github.com/ywateru/AnyWork'
BASE = 'https://ywateru.github.io/AnyWork'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fetch-release', action='store_true')
    args = parser.parse_args()
    release = None
    if args.fetch_release:
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'AnyWork-site-builder'}
        if os.environ.get('GH_TOKEN'):
            headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
        request = urllib.request.Request('https://api.github.com/repos/ywateru/AnyWork/releases/latest', headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
            release = {'tag_name': data['tag_name'], 'assets': [{key: item[key] for key in ['name', 'size', 'browser_download_url']} for item in data['assets']]}
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise RuntimeError(f'Cannot read release metadata: HTTP {error.code}') from None
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(SITE / 'assets', DIST / 'assets')
    for name in ['style.css', 'app.js']:
        shutil.copy2(SITE / name, DIST / name)
    (DIST / '.nojekyll').touch()
    (DIST / 'release.json').write_text(json.dumps(release, ensure_ascii=False) + '\n')
    template = Template((SITE / 'template.html').read_text())
    for lang in ['en', 'zh']:
        raw = json.loads((SITE / f'locales/{lang}.json').read_text())
        for root in [False, True] if lang == 'en' else [False]:
            values = {k: html.escape(v, quote=True) for k, v in raw.items()}
            for key in ['headline', 'manifesto', 'connectTitle', 'downloadTitle', 'closing']:
                values[key] = values[key].replace('&lt;br&gt;', '<br>')
            prefix = '.' if root else '..'
            values.update(assetPrefix=prefix, htmlLang='zh-CN' if lang == 'zh' else 'en', otherHtmlLang='zh-CN' if lang == 'en' else 'en', homeUrl='./', otherUrl=('./' if root else '../') + raw['otherLang'] + '/', canonical=BASE + ('/' if root else f'/{lang}/'), guideUrl=REPO + '/blob/main/docs/' + raw['guideFile'])
            # Only the language-neutral entry point negotiates language. Deep
            # links and manual choices remain stable and shareable. Run before
            # rendering to avoid briefly showing English to Chinese browsers.
            values['languageRedirect'] = '''<script>
(() => {
  let preferred;
  try { preferred = localStorage.getItem('anywork-site-preferred-language'); } catch {}
  const browser = (navigator.languages || [navigator.language || 'en'])
    .map(language => language.toLowerCase().split('-')[0])
    .find(language => language === 'zh' || language === 'en') || 'en';
  const language = ['en', 'zh'].includes(preferred) ? preferred : browser;
  const target = new URL('./' + language + '/', location.href);
  target.search = location.search;
  target.hash = location.hash;
  location.replace(target.href);
})();
</script>''' if root else ''
            values['appVersion'] = html.escape(release['tag_name'] if release else 'v' + json.loads((ROOT / 'package.json').read_text())['version'])
            values['releaseStatus'] = html.escape(raw['releaseAvailable'] + ': ' + release['tag_name'] if release else raw['releaseLoading'])
            assets = {asset['name']: asset for asset in release['assets']} if release else {}
            def url(name):
                value = assets.get(name, {}).get('browser_download_url', REPO + '/releases')
                if not value.startswith(REPO + '/releases'):
                    raise ValueError('Unexpected release asset origin')
                return html.escape(value, quote=True)
            def button(name, label):
                return f'<a data-asset="{name}" data-label="{html.escape(label, quote=True)}" href="{url(name)}">{html.escape(label)} <span aria-hidden="true">↓</span></a>'
            values['macDownloads'] = button('anywork-macos-arm64.zip', raw['armMac']) + button('anywork-macos-x86_64.zip', raw['intelMac'])
            values['winDownloads'] = button('anywork-windows-x86_64.zip', raw['x64'])
            values['linuxDownloads'] = button('anywork-linux-x86_64.tar.gz', raw['x64']) + button('anywork-linux-arm64.tar.gz', raw['arm64'])
            values['androidDownloads'] = button('anywork-android.apk', raw['apk'])
            values['checksumUrl'] = url('SHA256SUMS')
            values['structuredData'] = json.dumps({'@context':'https://schema.org', '@type':'SoftwareApplication', 'name':'AnyWork', 'description':raw['description'], 'applicationCategory':'DeveloperApplication', 'operatingSystem':'macOS, Windows, Linux, Android, Web', 'url':BASE + '/' + lang + '/', 'license':REPO + '/blob/main/LICENSE', 'offers':{'@type':'Offer','price':'0','priceCurrency':'USD'}}, ensure_ascii=False).replace('<', '\\u003c')
            folder = DIST if root else DIST / lang
            folder.mkdir(exist_ok=True)
            (folder / 'index.html').write_text(template.substitute(values), encoding='utf-8')
    (DIST / '404.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page not found · AnyWork</title><body style="font:18px system-ui;padding:10vh 8vw;color:#183B56;background:#F5F8FB"><h1>Page not found / 页面不存在</h1><p><a href="/AnyWork/en/">AnyWork · English</a></p><p><a href="/AnyWork/zh/">AnyWork · 中文</a></p></body></html>')
    (DIST / 'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: '+BASE+'/sitemap.xml\n')
    (DIST / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+''.join('<url><loc>'+BASE+'/'+lang+'/</loc></url>' for lang in ['en','zh'])+'</urlset>')
    print('Built bilingual site: site/dist (en, zh, root, release metadata, SEO)')

if __name__ == '__main__':
    main()
