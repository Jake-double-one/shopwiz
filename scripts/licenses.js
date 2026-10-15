// Vite plugin: writes licenses.txt with the license of every third-party package that ends up in
// the app bundle (code, styles, fonts, images) – taken from the packages themselves, so the list
// can't fall behind when dependencies change.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PKG_RE = /^(.*[\\/]node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)/;
const LICENSE_FILE = /^(licen[cs]e|copying|ofl)(\.(md|txt))?$/i;

function packageInfo(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = readdirSync(dir);
  const file = files.find((f) => LICENSE_FILE.test(f));
  const notice = files.find((f) => /^notice(\.(md|txt))?$/i.test(f));
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || 'see text',
    url: pkg.homepage || (repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '') : ''),
    text: [file, notice].filter(Boolean).map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n'),
  };
}

export function thirdPartyLicenses({ fileName = 'licenses.txt', title = 'Third-party software' } = {}) {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      const dirs = new Set();
      for (const id of this.getModuleIds()) {
        const m = id.replace(/^\0/, '').split('?')[0].match(PKG_RE);
        if (m) dirs.add(m[1] + m[2]);
      }
      const pkgs = [...dirs].map(packageInfo).sort((a, b) => a.name.localeCompare(b.name));
      for (const p of pkgs) if (!p.text) this.warn(`${p.name}: no license file in the package`);
      const line = '='.repeat(72);
      const parts = [
        `${title}\n\nShopWiz contains the following software and fonts. Each one is used under its own\nlicense; the full texts follow.`,
        pkgs.map((p) => `- ${p.name} ${p.version} (${p.license})`).join('\n'),
        ...pkgs.map((p) => `${line}\n${p.name} ${p.version} – ${p.license}${p.url ? `\n${p.url}` : ''}\n${line}\n\n${p.text || `License: ${p.license}`}`),
      ];
      this.emitFile({ type: 'asset', fileName, source: `${parts.join('\n\n')}\n` });
    },
  };
}
