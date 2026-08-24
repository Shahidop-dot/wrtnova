#!/usr/bin/env node

// Build public/wrtnova.sh from the canonical root script and embed
// the latest Footstrap APK for offline first boot.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const localPath = resolve(root, 'wrtnova.sh');

if (!existsSync(localPath)) {
  console.error('Missing canonical wrtnova.sh at repo root: ' + localPath);
  process.exit(1);
}

async function getFootstrap() {
  const api =
    'https://api.github.com/repos/VizzleTF/luci-theme-footstrap/releases/latest';

  const response = await fetch(api, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'WrtNova-build'
    }
  });

  if (!response.ok) {
    throw new Error(`Footstrap API failed: HTTP ${response.status}`);
  }

  const release = await response.json();

  const asset = (release.assets || []).find(a =>
    /^luci-theme-footstrap-.*\.apk$/.test(a.name)
  );

  if (!asset) {
    throw new Error(
      `No Footstrap APK found in ${release.tag_name || 'latest release'}`
    );
  }

  console.log(
    `Embedding Footstrap ${release.tag_name}: ${asset.name}`
  );

  const pkg = await fetch(asset.browser_download_url, {
    headers: {
      'User-Agent': 'WrtNova-build'
    }
  });

  if (!pkg.ok) {
    throw new Error(
      `Footstrap APK download failed: HTTP ${pkg.status}`
    );
  }

  return {
    name: asset.name,
    base64: Buffer
      .from(await pkg.arrayBuffer())
      .toString('base64')
  };
}

const footstrap = await getFootstrap();

let sh = readFileSync(localPath, 'utf8');

const marker = '[ -x /bin/run-cmd ] && exit 0';

if (!sh.includes(marker)) {
  throw new Error(
    'Could not find WrtNova insertion point: ' + marker
  );
}

// Remove an older embedded Footstrap block if this script
// has already generated public/wrtnova.sh before.
const startMarker = '# === WrtNova embedded Footstrap ===';
const endMarker = '# === End WrtNova embedded Footstrap ===';

const oldBlock = new RegExp(
  `\\n${startMarker}\\n[\\s\\S]*?${endMarker}\\n`,
  'm'
);

sh = sh.replace(oldBlock, '\n');

const installer = `
${startMarker}

install_embedded_footstrap() {
    local apk_file="/tmp/luci-theme-footstrap.apk"
    local apk_b64='${footstrap.base64}'

    printf '%s' "$apk_b64" | base64 -d > "$apk_file" 2>/dev/null || {
        echo "WrtNova: failed to decode embedded Footstrap"
        rm -f "$apk_file"
        return 0
    }

    if [ ! -s "$apk_file" ]; then
        echo "WrtNova: embedded Footstrap APK is empty"
        rm -f "$apk_file"
        return 0
    fi

    if command -v apk >/dev/null 2>&1; then
        echo "WrtNova: installing embedded Footstrap (${footstrap.name})"

        apk add --allow-untrusted "$apk_file" >/dev/null 2>&1 || {
            echo "WrtNova: Footstrap installation failed"
            rm -f "$apk_file"
            return 0
        }
    else
        echo "WrtNova: apk not found; Footstrap requires OpenWrt 25.12+"
        rm -f "$apk_file"
        return 0
    fi

    # Make Footstrap the default LuCI theme.
    uci -q set luci.themes.Footstrap='/luci-static/footstrap'
    uci -q set luci.main.mediaurlbase='/luci-static/footstrap'
    uci -q commit luci

    rm -f "$apk_file"
    rm -rf /tmp/luci-* 2>/dev/null

    echo "WrtNova: Footstrap installed and selected"
}

install_embedded_footstrap

${endMarker}
`;

sh = sh.replace(
  marker,
  installer + '\n' + marker
);

writeFileSync(
  resolve(root, 'public/wrtnova.sh'),
  sh
);

console.log(
  `Wrote public/wrtnova.sh with embedded Footstrap (${footstrap.name})`
);

console.log(
  `Embedded Footstrap payload: ${footstrap.base64.length} base64 characters`
);
