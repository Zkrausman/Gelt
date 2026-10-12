"""Capture installed lockfile packages' notices, without fetching other platforms.
Run from v2 after npm ci. Review generated deltas; not a legal audit.
"""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / 'notices'
out.mkdir(exist_ok=True)
records = []
for path, info in json.loads((root / 'package-lock.json').read_text())['packages'].items():
    if not path or info.get('link') or 'node_modules/' not in path:
        continue
    folder = root / path
    notices = []
    if folder.exists():
        for file in sorted(folder.rglob('*')):
            if not file.is_file() or 'node_modules' in file.relative_to(folder).parts:
                continue
            if file.name.lower().split('.')[0] not in ('license', 'licence', 'notice', 'copyright', 'license-mit'):
                continue
            content = file.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            (out / (digest + '.txt')).write_bytes(content)
            notices.append({'source': str(file.relative_to(folder)), 'text': 'notices/' + digest + '.txt', 'sha256': digest})
    records.append({'path': path, 'version': info.get('version'), 'license': info.get('license', 'not declared in lockfile'),
                    'installedOnCapturePlatform': folder.exists(), 'notices': notices})
(root / 'DEPENDENCY-NOTICES.json').write_text(json.dumps({'capturePlatform': 'linux-x64',
    'scope': 'Pinned lockfile inventory and verbatim installed package notices, including bundled notices; absent optional platform packages remain in lockfile, not redistributed here. No legal or vulnerability audit claimed.',
    'packages': records}, indent=2) + '\n')
