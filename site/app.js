/* Static product preview. It never connects to a user's agent or executes a command. */
function tabs(selector, attr, panelPrefix, onChange) {
  const items = [...document.querySelectorAll(selector)];
  function select(item, focus = false) {
    for (const button of items) {
      const active = button === item;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      document.getElementById(panelPrefix + button.dataset[attr]).hidden = !active;
    }
    if (focus) item.focus();
    onChange?.(item.dataset[attr]);
  }
  for (const [index, item] of items.entries()) {
    item.addEventListener('click', () => select(item));
    item.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % items.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      if (next !== undefined) { event.preventDefault(); select(items[next], true); }
    });
  }
}
tabs('[data-preview]', 'preview', 'panel-');
tabs('[data-route]', 'route', 'route-panel-', route => {
  document.querySelector('.connection-figure').dataset.current = route;
  document.querySelector('.network-route-label').textContent = {lan:'LAN',tunnel:'HTTPS',vpn:'WireGuard'}[route];
});
document.querySelector('#demo-approve').addEventListener('click', event => {
  event.target.textContent = event.target.dataset.approved;
  event.target.disabled = true;
});
for (const toggle of document.querySelectorAll('[data-demo-switch]')) {
  toggle.addEventListener('click', () => {
    const enabled = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(enabled));
    const status = document.querySelector(`[data-switch-status="${toggle.dataset.demoSwitch}"]`);
    status.textContent = enabled ? status.dataset.on : status.dataset.off;
  });
}
// Remember explicit choices only. An automatically selected page must not
// overwrite the browser's preference, and explicit language URLs never redirect.
document.querySelector('a.language').addEventListener('click', event => {
  const language = event.currentTarget.getAttribute('hreflang') === 'zh-CN' ? 'zh' : 'en';
  try { localStorage.setItem('anywork-site-preferred-language', language); } catch {}
});
const releaseURL = 'https://api.github.com/repos/ywateru/AnyWork/releases/latest';
function versionParts(tag) {
  return typeof tag === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)
    ? tag.replace(/^v/, '').split('.').map(BigInt) : null;
}
let appliedVersion = versionParts(document.body.dataset.releaseVersion);
function applyRelease(release) {
  if (!release || !Array.isArray(release.assets) || release.draft || release.prerelease) return;
  const version = versionParts(release.tag_name);
  if (!version) return;
  if (appliedVersion) {
    for (let index = 0; index < 3; index++) {
      if (version[index] < appliedVersion[index]) return;
      if (version[index] > appliedVersion[index]) break;
    }
  }
  appliedVersion = version;
  const assets = new Map(release.assets.map(asset => [asset.name, asset]));
  for (const link of document.querySelectorAll('[data-asset]')) {
    const asset = assets.get(link.dataset.asset);
    if (!asset || typeof asset.browser_download_url !== 'string' || !asset.browser_download_url.startsWith('https://github.com/ywateru/AnyWork/releases/download/')) continue;
    link.href = asset.browser_download_url;
    if (asset.size > 0) link.title = `${link.dataset.label || link.textContent.trim()} · ${(asset.size / 1048576).toFixed(1)} MB`;
  }
  const status = document.querySelector('#release-status');
  status.textContent = `${status.dataset.available}: ${release.tag_name}`;
}
// Build-time release data is the baseline; a live refresh improves freshness without blocking downloads.
fetch(`${document.body.dataset.prefix}/release.json`).then(response => response.ok ? response.json() : null).then(applyRelease).catch(() => {});
fetch(releaseURL, {headers: {Accept:'application/vnd.github+json'}, signal: AbortSignal.timeout(6000)}).then(response => response.ok ? response.json() : null).then(applyRelease).catch(() => {});
