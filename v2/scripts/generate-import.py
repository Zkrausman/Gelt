"""Rebuild the complete import accounting against the exact public source pin.
Usage: python3 v2/scripts/generate-import.py /path/to/upstream-checkout
The manifest is review evidence, never permission to trust imported code.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

PIN = '6feb4869489c8ac9537b1405547983591e1d3263'
root = Path(__file__).resolve().parents[1]
upstream = Path(sys.argv[1])
def git(*args):
    return subprocess.check_output(['git', '-C', str(upstream), *args])
assert git('rev-parse', 'HEAD').decode().strip() == PIN
omissions = {
    '.claude/launch.json': 'Local editor/host configuration excluded',
    '.github/workflows/ci.yml': 'Do not activate upstream CI/deployment; Gelt CI is separate',
    'docker-compose.yml': 'Deployment activation out of scope',
    'server/Dockerfile': 'Deployment activation out of scope',
    'web/Dockerfile': 'Deployment activation out of scope',
    'web/tsconfig.tsbuildinfo': 'Generated build cache excluded',
}
modified = {
    'server/src/cache.ts': 'Remove upstream extra EOF blank line for diff hygiene; no behavior change',
    'server/src/providers/nasdaq.ts': 'Remove upstream extra EOF blank line for diff hygiene; no behavior change',
    'server/src/providers/yahoo.ts': 'Remove upstream extra EOF blank line for diff hygiene; no behavior change',
    '.gitignore': 'Scoped JSON source exception and build-cache ignore',
    'README.md': 'Gelt provenance, offline startup, authority and licensing documentation',
    'package.json': 'Foundation build/test/start scripts; unchanged dependencies/workspaces',
    'server/src/index.ts': 'Offline-only loopback health; no provider, AI, portfolio or DB imports',
    'web/app/page.tsx': 'Offline landing page instead of provider-connected terminal',
    'web/app/api/[...path]/route.ts': 'Remove generic proxy/credential relay; all API surfaces disabled',
    'web/next.config.ts': 'Local next start instead of standalone deployment, bounded build CPUs',
    'web/package.json': 'Loopback-only direct web script defaults; unchanged dependencies',
}
def digest(data): return hashlib.sha256(data).hexdigest()
entries = []
paths = git('ls-tree', '-r', '--name-only', PIN).decode().splitlines()
for path in paths:
    original = git('show', PIN + ':' + path)
    target = root / path
    row = {'upstreamPath': path, 'upstreamSha256': digest(original)}
    if path in omissions:
        assert not target.exists()
        row.update(status='omitted', path=None, sha256=None, reason=omissions[path])
    else:
        content = target.read_bytes()
        status = 'retained' if content == original else 'modified'
        if status == 'modified': assert path in modified, path
        row.update(status=status, path=path, sha256=digest(content), reason=modified[path] if status == 'modified' else 'Verbatim upstream source/asset')
    entries.append(row)
for file in sorted(root.rglob('*')):
    path = str(file.relative_to(root))
    if not file.is_file() or any(p in ('node_modules', '.next', 'dist') for p in file.relative_to(root).parts) or path.endswith('.tsbuildinfo'):
        continue
    if path in paths or path == 'IMPORT-MANIFEST.json': continue
    entries.append({'upstreamPath': None, 'upstreamSha256': None, 'status': 'added', 'path': path,
                    'sha256': digest(file.read_bytes()), 'reason': 'Gelt M2 foundation source, test, documentation or dependency notice'})
entries.append({'upstreamPath': None, 'upstreamSha256': None, 'status': 'added', 'path': 'IMPORT-MANIFEST.json', 'sha256': None, 'reason': 'Complete accounting; self-hash excluded to avoid recursion'})
(root / 'IMPORT-MANIFEST.json').write_text(json.dumps({'source': 'https://github.com/ErTasselli/OpenTerminal', 'commit': PIN,
    'hashAlgorithm': 'sha256', 'entries': entries}, indent=2) + '\n')
