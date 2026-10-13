"""Real stdio case receipts for the selected, finite-JSON numerical contract."""
import asyncio
import copy
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import sys

import numpy as np
from pypfopt import EfficientFrontier
from fastmcp import Client
from adapter import FIXTURE, SOLVER_OPTIONS, minimum_variance
from oracle import active_set_oracle
from verify import transport
from delivery import canonical, sha, supported, checked_archive

ROOT = Path(__file__).resolve().parent

def invalid_cases():
    cases = []
    def add(name, mutate):
        request = copy.deepcopy(FIXTURE); mutate(request); cases.append((name, request))
    add('extra-field', lambda r: r.update(unexpected=True))
    add('duplicate-tickers', lambda r: r.update(tickers=['AGG', 'AGG', 'GLD', 'HYG']))
    add('lowercase-ticker', lambda r: r.update(tickers=['a', 'SPY', 'GLD', 'HYG']))
    add('too-few-labels', lambda r: r.update(tickers=['AGG']))
    add('too-many-labels', lambda r: r.update(tickers=['A'] * 9))
    add('missing-matrix-row', lambda r: r['covariance'].pop())
    add('missing-matrix-column', lambda r: r['covariance'][0].pop())
    add('entry-above-bound', lambda r: r['covariance'][0].__setitem__(0, 101))
    add('negative-diagonal', lambda r: r['covariance'][0].__setitem__(0, -1))
    add('boolean-entry', lambda r: r['covariance'][0].__setitem__(0, True))
    add('string-entry', lambda r: r['covariance'][0].__setitem__(0, '0.000859'))
    add('asymmetric-matrix', lambda r: r['covariance'][0].__setitem__(1, 0))
    for name, matrix in [
        ('positive-diagonal-indefinite', [[1, 2], [2, 1]]),
        ('tiny-negative-diagonal', [[-1e-13, 0], [0, 0]]),
        ('mixed-negative-diagonal', [[1, 0], [0, -1e-14]]),
        ('below-normalization-floor', [[1e-250, 0], [0, 1e-250]]),
        ('negative-subnormal', [[100, 0], [0, -5e-324]]),
        ('normalization-erases-entry', [[100, 5e-324], [5e-324, 1]]),
    ]:
        cases.append((name, {'tickers': ['A', 'B'], 'covariance': matrix}))
    return cases

def valid_cases():
    cases = [('pinned-fixture', copy.deepcopy(FIXTURE), True)]
    for index, magnitude in enumerate([1e-150, 1e-12, 1.0, 25.0]):
        cases.append((f'scale-{index}', {'tickers': ['A', 'B'], 'covariance': [[magnitude, 0], [0, 4 * magnitude]]}, True))
    for name, matrix in [('zero', [[0, 0], [0, 0]]), ('singular', [[1, 1], [1, 1]]), ('boundary', [[0, 0], [0, 1]])]:
        cases.append((name, {'tickers': ['A', 'B'], 'covariance': matrix}, False))
    permutation = [3, 1, 0, 2]; covariance = np.array(FIXTURE['covariance'])
    cases.append(('permuted-fixture', {'tickers': [FIXTURE['tickers'][i] for i in permutation],
                                    'covariance': covariance[np.ix_(permutation, permutation)].tolist()}, True))
    return cases

def upstream_reference(request):
    covariance = np.array(request['covariance']); scale = float(np.max(np.abs(covariance)))
    ef = EfficientFrontier(None, covariance / scale if scale else covariance,
                           weight_bounds=(0, 1), solver='CLARABEL', solver_options=SOLVER_OPTIONS)
    ef.min_volatility(); weights = ef._w.value
    return {'weights': weights.tolist(), 'variance': float(weights @ covariance @ weights)}

async def run_cases():
    receipts = []
    async with Client(transport()) as client:
        tools = await client.list_tools()
        if [tool.name for tool in tools] != ['min_variance']:
            raise ValueError('unexpected tool inventory')
        discovery = {'protocol': client.protocol_version, 'server': client.server_info.model_dump(mode='json'),
                     'tool': tools[0].model_dump(mode='json')}
        for name, request, unique in valid_cases():
            result = await client.call_tool('min_variance', {'request': request})
            if result.is_error:
                raise ValueError('expected successful MCP case failed')
            output = result.structured_content
            direct = upstream_reference(request); oracle = active_set_oracle(request['covariance'])
            scale = float(np.max(np.abs(request['covariance']))) or 1.0
            if abs(output['variance'] - direct['variance']) / scale > 1e-8 or abs(output['variance'] - oracle['variance']) / scale > 1e-8:
                raise ValueError('source/oracle objective mismatch')
            for field, limit in [('budget_residual', 1e-8), ('bound_violation', 1e-8), ('normalized_stationarity_residual', 1e-7), ('normalized_dual_violation', 1e-7), ('normalized_complementarity_residual', 1e-8)]:
                if not np.isfinite(output[field]) or output[field] > limit:
                    raise ValueError('numerical certificate failed')
            if unique:
                np.testing.assert_allclose(output['weights'], direct['weights'], atol=1e-12, rtol=1e-12)
                np.testing.assert_allclose(output['weights'], oracle['weights'], atol=1e-7, rtol=1e-7)
            receipts.append({'case': name, 'input': request, 'input_sha256': sha(canonical(request)),
                             'mcp_output': output, 'output_sha256': sha(canonical(output)),
                             'direct_source': direct, 'independent_oracle': oracle,
                             'comparison': 'weights/objective' if unique else 'objective/certificates; nonunique weights not equated',
                             'outcome': 'passed'})
        for name, request in invalid_cases():
            try:
                minimum_variance(request)
            except ValueError:
                pass
            else:
                raise ValueError('direct contract accepted invalid case')
            result = await client.call_tool('min_variance', {'request': request}, raise_on_error=False)
            if not result.is_error:
                raise ValueError('MCP contract accepted invalid case')
            receipts.append({'case': name, 'input': request, 'input_sha256': sha(canonical(request)),
                             'direct_adapter': 'rejected', 'mcp_is_error': True,
                             'mcp_content_sha256': sha(canonical([item.model_dump(mode='json') for item in result.content])),
                             'error_text_retained': False, 'outcome': 'passed'})
    # IEEE NaN/Infinity are not standard JSON numbers. Do not claim on-wire tool
    # parity for Python-only values or depend on a client's null/extension encoding.
    non_json = []
    for name, value in [('nan', float('nan')), ('infinity', float('inf'))]:
        request = copy.deepcopy(FIXTURE); request['covariance'][0][0] = value
        try:
            minimum_variance(request)
        except ValueError:
            non_json.append({'case': name, 'direct_adapter': 'rejected', 'mcp_scope': 'not a finite-JSON request; no tool-parity claim'})
        else:
            raise ValueError('direct contract accepted nonfinite case')
    return {'discovery': discovery, 'discovery_sha256': sha(canonical(discovery)),
            'cases': receipts, 'non_json_direct_cases': non_json,
            'scope': 'selected finite-JSON covariance-only min_variance contract; no strategy/market/agent/trade evidence'}

async def main():
    supported()
    if len(sys.argv) != 4:
        raise ValueError('archive, expected digest and fresh output required')
    manifest, contents = checked_archive(sys.argv[1], sys.argv[2])
    if any(sha((ROOT / name).read_bytes()) != sha(data) for name, data in contents.items()):
        raise ValueError('extracted source differs from archive')
    if importlib.metadata.version('PyPortfolioOpt') != '1.6.0':
        raise ValueError('upstream runtime version mismatch')
    receipt = await asyncio.wait_for(run_cases(), timeout=180)
    receipt.update({'archive_sha256': sys.argv[2], 'manifest': manifest,
                    'extracted_root': str(ROOT), 'python_version': platform.python_version(),
                    'python_implementation': platform.python_implementation(),
                    'python_executable_sha256': sha(Path(sys.executable).resolve().read_bytes()),
                    'lock_sha256': sha((ROOT / 'uv.lock').read_bytes()),
                    'licenses': {name: sha(data) for name, data in contents.items() if name.startswith('licenses/')},
                    'owner_consumption': 'unobserved', 'agent_decisions': 'not_run', 'real_trades': 'disabled'})
    output = Path(sys.argv[3])
    with output.open('xb') as file:
        file.write(canonical(receipt) + b'\n')
    print(json.dumps({'outcome': 'passed', 'finite_json_cases': len(receipt['cases']),
                      'receipt_sha256': sha(canonical(receipt) + b'\n')}))

if __name__ == '__main__':
    asyncio.run(main())
