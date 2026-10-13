"""Trusted Linux source-package builder and strict fresh-location extractor."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
PREFIX = 'gelt-paper2agent-reference/'
FILES = tuple(sorted([
    'README.md', 'NOTICE.md', 'adapter.py', 'server.py', 'oracle.py', 'verify.py',
    'test_adapter.py', 'pyproject.toml', 'uv.lock', 'delivery.py', 'parity.py', 'test_delivery.py',
    'artifacts/evidence.json', 'artifacts/mcp-output.json', 'artifacts/mcp-handshake.json',
    'licenses/PyPortfolioOpt-MIT.txt', 'licenses/Paper2Agent-MIT.txt',
    'licenses/fastmcp-0.txt', 'licenses/clarabel-0.txt',
]))
PINS = {
    'adapter.py': '0c7744fdfa7cf79ffcb398f6e19dedb2e88655effff2b443ee246a647dd8243a',
    'server.py': 'c58a92777798e339c151c523042c11f28d1ac5d7b8fae2f34f82f4f650f7cbf1',
    'oracle.py': '4ed669a1b1673e704d2170f6616c7f0a875af8c308cdf88454237d0c375bf38f',
    'verify.py': '14d52ab650b17ab9ca23abb17b0b138e9fda89d424678af4586bb091a4812530',
    'uv.lock': '736b702611b360942ac3def4d42fb4b235e9c262aeaaf5090759cd31f32a7dd4',
    'artifacts/evidence.json': 'c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96',
}
UPSTREAM = '0186e707a0d2ec03406608d3400539d0f140c625'
WORKFLOW = '8c2d059165ef8cdcb70dbea76655b9c2b55b38e6'
LIMIT = 4 * 1024 * 1024

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate manifest key')
        result[key] = value
    return result

def supported():
    if sys.platform != 'linux' or sys.version_info[:2] != (3, 12) or sys.implementation.name != 'cpython':
        raise ValueError('supported runtime is Linux Python 3.12')

def fresh_directory(destination):
    destination = Path(destination)
    if not destination.is_absolute() or destination.parent.resolve(strict=True) != destination.parent:
        raise ValueError('explicit non-symlink absolute destination required')
    if os.path.lexists(destination):
        raise ValueError('destination must be fresh')
    destination.mkdir(mode=0o700)
    return destination

def source_files(root=ROOT):
    root = Path(root)
    result = {}
    for name in FILES:
        path = root / name
        if any(part.is_symlink() for part in [path, *path.parents] if part != root.parent):
            raise ValueError('source symlink forbidden')
        if not path.is_file() or path.stat().st_size > LIMIT:
            raise ValueError('source file unavailable or oversized')
        result[name] = path.read_bytes()
    if sum(map(len, result.values())) > LIMIT:
        raise ValueError('source package oversized')
    for name, expected in PINS.items():
        if sha(result[name]) != expected:
            raise ValueError('immutable reference pin mismatch')
    return result

def build(destination, source_commit, root=ROOT):
    if not re.fullmatch('[0-9a-f]{40}', source_commit):
        raise ValueError('explicit checked-out source commit required')
    contents = source_files(root)
    manifest = {'format': 'gelt.paper-package.v1', 'canonical_repository_id': 1415613140,
                'source_commit': source_commit, 'upstream_commit': UPSTREAM,
                'paper2agent_workflow_commit': WORKFLOW, 'support': 'Linux Python 3.12',
                'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in contents.items()}}
    contents['manifest.json'] = canonical(manifest) + b'\n'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(contents):
            info = zipfile.ZipInfo(PREFIX + name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, contents[name])
    encoded = buffer.getvalue()
    if len(encoded) > LIMIT:
        raise ValueError('archive oversized')
    destination = fresh_directory(destination)
    with (destination / 'paper-package.zip').open('xb') as output:
        output.write(encoded)
    receipt = {'archive_sha256': sha(encoded), 'archive_bytes': len(encoded), 'manifest': manifest,
               'boundary': 'reviewed source, fixed reference artifacts and licenses; dependencies separately resolved by frozen uv.lock'}
    with (destination / 'package-receipt.json').open('xb') as output:
        output.write(canonical(receipt) + b'\n')
    return receipt

def checked_archive(archive_path, expected_sha):
    path = Path(archive_path)
    if not re.fullmatch('[0-9a-f]{64}', expected_sha) or path.stat().st_size > LIMIT:
        raise ValueError('archive identity or size invalid')
    with path.open('rb') as file:
        encoded = file.read(LIMIT + 1)
    if len(encoded) > LIMIT:
        raise ValueError('archive oversized')
    if sha(encoded) != expected_sha:
        raise ValueError('archive digest mismatch')
    with zipfile.ZipFile(io.BytesIO(encoded)) as archive:
        infos = archive.infolist()
        expected = {PREFIX + name for name in (*FILES, 'manifest.json')}
        if len(infos) != len(expected) or {info.filename for info in infos} != expected:
            raise ValueError('archive inventory mismatch')
        if any(info.is_dir() or info.flag_bits & 1 or info.compress_type != zipfile.ZIP_STORED
               or stat.S_IFMT(info.external_attr >> 16) != stat.S_IFREG
               or info.file_size > LIMIT for info in infos):
            raise ValueError('archive member type/encoding invalid')
        if sum(info.file_size for info in infos) > LIMIT:
            raise ValueError('archive contents oversized')
        contents = {info.filename[len(PREFIX):]: archive.read(info) for info in infos}
    manifest = json.loads(contents.pop('manifest.json'), object_pairs_hook=unique_object)
    if not isinstance(manifest, dict) or set(manifest) != {'format', 'canonical_repository_id', 'source_commit', 'upstream_commit', 'paper2agent_workflow_commit', 'support', 'files'}:
        raise ValueError('manifest fields invalid')
    if manifest['format'] != 'gelt.paper-package.v1' or manifest['canonical_repository_id'] != 1415613140 or manifest['support'] != 'Linux Python 3.12':
        raise ValueError('manifest identity invalid')
    if manifest['upstream_commit'] != UPSTREAM or manifest['paper2agent_workflow_commit'] != WORKFLOW or not re.fullmatch('[0-9a-f]{40}', manifest['source_commit']):
        raise ValueError('manifest source pin invalid')
    if not isinstance(manifest['files'], dict) or set(manifest['files']) != set(FILES):
        raise ValueError('manifest inventory invalid')
    for name, data in contents.items():
        entry = manifest['files'][name]
        if not isinstance(entry, dict) or set(entry) != {'sha256', 'bytes'} or type(entry['bytes']) is not int or entry['bytes'] != len(data) or entry['sha256'] != sha(data):
            raise ValueError('manifest member mismatch')
    if any(sha(contents[name]) != expected for name, expected in PINS.items()):
        raise ValueError('immutable extracted pin mismatch')
    return manifest, contents

def extract(archive_path, expected_sha, destination):
    manifest, contents = checked_archive(archive_path, expected_sha)
    destination = fresh_directory(destination)
    for name, data in contents.items():
        path = destination / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open('xb') as output:
            output.write(data)
        if sha(path.read_bytes()) != manifest['files'][name]['sha256']:
            raise ValueError('extracted-byte verification failed')
    with (destination / 'manifest.json').open('xb') as output:
        output.write(canonical(manifest) + b'\n')
    return {'archive_sha256': expected_sha, 'source_commit': manifest['source_commit'],
            'extracted_root': str(destination.resolve()), 'verified_files': len(contents),
            'extracted_manifest_sha256': sha(canonical(manifest) + b'\n')}

def main():
    supported()
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='operation', required=True)
    build_parser = sub.add_parser('build'); build_parser.add_argument('destination'); build_parser.add_argument('--source-commit', required=True)
    extract_parser = sub.add_parser('extract'); extract_parser.add_argument('archive'); extract_parser.add_argument('sha256'); extract_parser.add_argument('destination')
    args = parser.parse_args()
    receipt = build(args.destination, args.source_commit) if args.operation == 'build' else extract(args.archive, args.sha256, args.destination)
    print(canonical(receipt).decode())

if __name__ == '__main__':
    main()
