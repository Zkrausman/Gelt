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


def stub_nonunique_response(monkeypatch, request, output):
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

    monkeypatch.setattr(parity, 'Client', lambda _: FakeClient())
    monkeypatch.setattr(parity, 'transport', lambda: None)
    monkeypatch.setattr(parity, 'valid_cases', lambda: [('synthetic-nonunique', request, False)])


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

    def unexpected_reference(*args):
        pytest.fail('malformed response reached a numerical reference')

    stub_nonunique_response(monkeypatch, request, output)
    monkeypatch.setattr(parity, 'upstream_reference', unexpected_reference)
    monkeypatch.setattr(parity, 'active_set_oracle', unexpected_reference)
    with pytest.raises(ValueError, match=message):
        asyncio.run(parity.run_cases())


@pytest.mark.parametrize('tickers', [['B', 'A'], ['HYG', 'SPY', 'AGG', 'GLD']])
def test_parity_reads_valid_response_in_request_order(tickers):
    remaining = len(tickers) - 1
    output = {'tickers': tickers.copy(), 'weights': [0] + [1 / remaining] * remaining}
    assert parity.read_case_output(output, tickers) is output


def parity_output(weights, variance):
    return {
        'tickers': ['B', 'A'],
        'weights': weights,
        'variance': variance,
        'budget_residual': 0.0,
        'bound_violation': 0.0,
        'normalized_stationarity_residual': 0.0,
        'normalized_dual_violation': 0.0,
        'normalized_complementarity_residual': 0.0,
    }


@pytest.mark.parametrize(('weights', 'variance', 'covariance', 'message'), [
    ([0.25, 0.5], 0, [[0, 0], [0, 0]], 'not fully invested'),
    ([-0.25, 1.25], 0, [[0, 0], [0, 0]], 'violate long-only bounds'),
    ([10**400, 0], 0, [[0, 0], [0, 0]], 'violate long-only bounds'),
    ([0.5, 0.5], 0, [[0, 0], [0, 4]], 'variance does not match'),
    ([0.5, 0.5], 1, [[0, 0], [0, 0]], 'variance does not match'),
    ([0.5, 0.5], 10**400, [[0, 0], [0, 4]], 'not finite at covariance scale'),
    ([0.5, 0.5], float('nan'), [[0, 0], [0, 4]], 'must be a finite JSON number'),
    ([0.5, 0.5], False, [[0, 0], [0, 4]], 'must be a finite JSON number'),
], ids=['budget', 'bounds', 'huge-weight', 'wrong-variance', 'zero-matrix',
        'huge-variance', 'nonfinite-variance', 'boolean-variance'])
def test_parity_rejects_unbound_returned_weights(monkeypatch, weights, variance, covariance, message):
    request = {'tickers': ['B', 'A'], 'covariance': covariance}
    stub_nonunique_response(monkeypatch, request, parity_output(weights, variance))

    def unexpected_reference(*args):
        pytest.fail('invalid returned weights or variance reached a numerical reference')

    monkeypatch.setattr(parity, 'upstream_reference', unexpected_reference)
    monkeypatch.setattr(parity, 'active_set_oracle', unexpected_reference)
    with pytest.raises(ValueError, match=message):
        asyncio.run(parity.run_cases())


@pytest.mark.parametrize('variance', [0, 4])
def test_parity_accepts_unequal_nonunique_optima(monkeypatch, variance):
    covariance = [[variance, variance], [variance, variance]]
    request = {'tickers': ['B', 'A'], 'covariance': covariance}
    output = parity_output([0.75, 0.25], variance)
    stub_nonunique_response(monkeypatch, request, output)
    monkeypatch.setattr(parity, 'invalid_cases', lambda: [])
    monkeypatch.setattr(parity, 'upstream_reference', lambda _: {'weights': [0.5, 0.5], 'variance': variance})
    monkeypatch.setattr(parity, 'active_set_oracle', lambda _: {'weights': [1, 0], 'variance': variance})

    [case] = asyncio.run(parity.run_cases())['cases']
    assert case['outcome'] == 'passed'
    assert case['mcp_output']['weights'] == [0.75, 0.25]


def test_parity_rejects_self_consistent_but_nonoptimal_weights(monkeypatch):
    request = {'tickers': ['B', 'A'], 'covariance': [[0, 0], [0, 4]]}
    stub_nonunique_response(monkeypatch, request, parity_output([0.5, 0.5], 1))
    reference = {'weights': [1, 0], 'variance': 0}
    monkeypatch.setattr(parity, 'upstream_reference', lambda _: reference)
    monkeypatch.setattr(parity, 'active_set_oracle', lambda _: reference)
    with pytest.raises(ValueError, match='source/oracle objective mismatch'):
        asyncio.run(parity.run_cases())


def test_parity_rejects_stacked_variance_tolerances(monkeypatch):
    scale = 4
    request = {'tickers': ['B', 'A'], 'covariance': [[0, 0], [0, scale]]}
    second_weight = 0.000125
    reported_variance = 3.2e-8
    reference = {'weights': [1, 0], 'variance': 0}
    normalized_objective = second_weight ** 2
    normalized_report = reported_variance / scale

    # Each adjacent comparison passes on its own, but the objective from the
    # returned vector is outside tolerance of the reference optimum.
    assert abs(reported_variance - reference['variance']) / scale <= 1e-8
    assert abs(normalized_objective - normalized_report) <= 1e-8
    assert abs(normalized_objective - reference['variance'] / scale) > 1e-8

    output = parity_output([1 - second_weight, second_weight], reported_variance)
    stub_nonunique_response(monkeypatch, request, output)
    monkeypatch.setattr(parity, 'invalid_cases', lambda: [])
    monkeypatch.setattr(parity, 'upstream_reference', lambda _: reference)
    monkeypatch.setattr(parity, 'active_set_oracle', lambda _: reference)
    with pytest.raises(ValueError, match='source/oracle objective mismatch'):
        asyncio.run(parity.run_cases())


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
