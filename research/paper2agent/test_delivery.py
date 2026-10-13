import hashlib
import io
from pathlib import Path
import stat
import zipfile

import pytest
from delivery import build, extract, checked_archive, PREFIX, ROOT

def test_deterministic_package_fresh_extract_and_existing_destination_preserved(tmp_path):
    first = build(tmp_path / 'first', 'a' * 40)
    second = build(tmp_path / 'second', 'a' * 40)
    assert first['archive_sha256'] == second['archive_sha256']
    archive = tmp_path / 'first' / 'paper-package.zip'
    result = extract(archive, first['archive_sha256'], tmp_path / 'extracted')
    assert result['verified_files'] == 19
    for name, entry in first['manifest']['files'].items():
        assert hashlib.sha256((tmp_path / 'extracted' / name).read_bytes()).hexdigest() == entry['sha256']
        assert (tmp_path / 'extracted' / name).read_bytes() == (ROOT / name).read_bytes()
    marker = tmp_path / 'extracted' / 'owner-existing.txt'; marker.write_text('preserve')
    with pytest.raises(ValueError, match='fresh'):
        extract(archive, first['archive_sha256'], tmp_path / 'extracted')
    assert marker.read_text() == 'preserve'

@pytest.mark.parametrize('attack', ['traversal', 'symlink', 'changed-member', 'wrong-archive-digest'])
def test_archive_rejects_unsafe_or_unbound_content_before_creating_destination(tmp_path, attack):
    receipt = build(tmp_path / 'built', 'a' * 40)
    archive = tmp_path / 'built' / 'paper-package.zip'
    with zipfile.ZipFile(archive) as original:
        entries = [(info, original.read(info)) for info in original.infolist()]
    if attack == 'traversal':
        info = zipfile.ZipInfo('../escaped.py'); info.external_attr = (stat.S_IFREG | 0o644) << 16
        entries.append((info, b'not executed'))
    if attack == 'symlink':
        info, data = next((i, d) for i, d in entries if i.filename == PREFIX + 'README.md')
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
    if attack == 'changed-member':
        entries = [(i, b'changed' if i.filename == PREFIX + 'README.md' else d) for i, d in entries]
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_STORED) as modified:
        for info, data in entries:
            modified.writestr(info, data)
    encoded = buffer.getvalue(); attacked = tmp_path / 'attacked.zip'; attacked.write_bytes(encoded)
    expected = '0' * 64 if attack == 'wrong-archive-digest' else hashlib.sha256(encoded).hexdigest()
    with pytest.raises(ValueError):
        extract(attacked, expected, tmp_path / 'destination')
    assert not (tmp_path / 'destination').exists()
    assert not (tmp_path / 'escaped.py').exists()
