import asyncio
import hashlib
import io
from pathlib import Path
import stat
from types import SimpleNamespace
import zipfile

import pytest
from delivery import build, extract, checked_archive, PREFIX, ROOT
import parity


@pytest.mark.parametrize(('field', 'value', 'message'), [
    ('tickers', ['A', 'B'], 'tickers do not match'),
    ('tickers', ['B', 'C'], 'tickers do not match'),
    ('tickers', ['B'], 'tickers do not match'),
    ('weights', [0.5], 'weight count does not match'),
    ('weights', [0.5, 0.5, 0.0], 'weight count does not match'),
    ('weights', [0.5, '0.5'], 'weights must be finite JSON numbers'),
    ('weights', [False, 0.5], 'weights must be finite JSON numbers'),
    ('weights', [0.5, None], 'weights must be finite JSON numbers'),
    ('weights', [0.5, float('nan')], 'weights must be finite JSON numbers'),
    ('weights', [float('inf'), 0.5], 'weights must be finite JSON numbers'),
    ('weights', [0.5, float('-inf')], 'weights must be finite JSON numbers'),
])
def test_parity_rejects_invalid_response_before_numerical_references(monkeypatch, field, value, message):
    request = {'tickers': ['B', 'A'], 'covariance': [[1, 1], [1, 1]]}
    output = {'tickers': ['B', 'A'], 'weights': [0.5, 0.5]}
    output[field] = value

    class FakeClient:
        protocol_version = 'test'
        server_info = SimpleNamespace(model_dump=lambda **kwargs: {})
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def list_tools(self):
            return [SimpleNamespace(name='min_variance', model_dump=lambda **kwargs: {})]
        async def call_tool(self, name, arguments):
            assert (name, arguments) == ('min_variance', {'request': request})
            return SimpleNamespace(is_error=False, structured_content=output)

    def unexpected_reference(*args):
        pytest.fail('malformed response reached a numerical reference')

    monkeypatch.setattr(parity, 'Client', lambda _: FakeClient())
    monkeypatch.setattr(parity, 'transport', lambda: None)
    monkeypatch.setattr(parity, 'valid_cases', lambda: [('synthetic-nonunique', request, False)])
    monkeypatch.setattr(parity, 'upstream_reference', unexpected_reference)
    monkeypatch.setattr(parity, 'active_set_oracle', unexpected_reference)
    with pytest.raises(ValueError, match=message):
        asyncio.run(parity.run_cases())


@pytest.mark.parametrize('tickers', [['B', 'A'], ['HYG', 'SPY', 'AGG', 'GLD']])
def test_parity_reads_valid_response_in_request_order(tickers):
    remaining = len(tickers) - 1
    output = {'tickers': tickers.copy(), 'weights': [0] + [1 / remaining] * remaining}
    assert parity.read_case_output(output, tickers) is output

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
