import asyncio
import copy
import json
from pathlib import Path
import numpy as np
import pytest
from pydantic import ValidationError
from adapter import FIXTURE, Request, minimum_variance
from oracle import active_set_oracle
from verify import build_evidence, run_mcp, transport
from fastmcp import Client

@pytest.mark.parametrize('mutate',[
 lambda r:r.update(unexpected=True),
 lambda r:r.update(tickers=['AGG','AGG','GLD','HYG']),
 lambda r:r.update(tickers=['a','SPY','GLD','HYG']),
 lambda r:r.update(tickers=['AGG']),
 lambda r:r.update(tickers=['A']*9),
 lambda r:r['covariance'].pop(),
 lambda r:r['covariance'][0].pop(),
 lambda r:r['covariance'][0].__setitem__(0,float('nan')),
 lambda r:r['covariance'][0].__setitem__(0,float('inf')),
 lambda r:r['covariance'][0].__setitem__(0,101),
 lambda r:r['covariance'][0].__setitem__(0,-1),
 lambda r:r['covariance'][0].__setitem__(0,True),
 lambda r:r['covariance'][0].__setitem__(0,'0.000859'),
 lambda r:r['covariance'][0].__setitem__(1,0),
])
def test_reject_invalid(mutate):
    request=copy.deepcopy(FIXTURE);mutate(request)
    with pytest.raises((ValueError,ValidationError)):minimum_variance(request)

def test_independent_oracle_and_ordering():
    result=minimum_variance(FIXTURE);oracle=active_set_oracle(FIXTURE['covariance'])
    np.testing.assert_allclose(result['weights'],oracle['weights'],atol=1e-7,rtol=1e-7)
    p=[3,1,0,2];c=np.array(FIXTURE['covariance'])
    permuted=minimum_variance({'tickers':[FIXTURE['tickers'][i] for i in p],'covariance':c[np.ix_(p,p)].tolist()})
    np.testing.assert_allclose(permuted['weights'],np.array(result['weights'])[p],atol=1e-7)

def test_singular_psd_and_simple_analytic_case():
    equal=minimum_variance({'tickers':['A','B'],'covariance':[[1,0],[0,1]]})
    np.testing.assert_allclose(equal['weights'],[.5,.5],atol=1e-8)
    zero=minimum_variance({'tickers':['A','B'],'covariance':[[0,0],[0,0]]})
    assert zero['variance']==0
    assert abs(sum(zero['weights'])-1)<1e-8

def test_actual_stdio_and_evidence():
    async def run():
        output,handshake=await run_mcp()
        evidence=build_evidence(output,handshake)
        assert evidence['recommendation']['promotionAllowed'] is False
        assert all(evidence['producerClaims'][s]['status']=='not_run' for s in ['historical','costs','shadow'])
        assert len(evidence['results'])==18
        async with Client(transport()) as client:
            bad=copy.deepcopy(FIXTURE);bad['covariance'][0][0]=True
            result=await client.call_tool('min_variance',{'request':bad},raise_on_error=False)
            assert result.is_error
    asyncio.run(run())

def test_source_commit_matches_installed():
    import hashlib,pypfopt
    expected={'objective_functions.py':'a8ec8dcb6240627fa19cd1d8012b5509432b505623a278f2fe962a95d63d9317','efficient_frontier/efficient_frontier.py':'97a80131e1e18a2d17d6bb88e0af95ab0d4e9fc5cc983606e92db2685c6c4948','base_optimizer.py':'3a5cb2d24d8910fc94298a2b81dcd91a3365e4745fcb0526b20610d63aa43f0c'}
    for name,sha in expected.items():
        assert hashlib.sha256((Path(pypfopt.__file__).parent/name).read_bytes()).hexdigest()==sha


def test_actual_mcp_scale_and_degenerate_regressions():
    async def run():
        async with Client(transport()) as client:
            for magnitude in [1e-150, 1e-12, 1.0, 25.0]:
                covariance=[[magnitude,0.],[0.,4*magnitude]]
                result=await client.call_tool('min_variance',{'request':{'tickers':['A','B'],'covariance':covariance}})
                output=result.structured_content
                oracle=active_set_oracle(covariance)
                np.testing.assert_allclose(output['weights'],[.8,.2],atol=1e-7,rtol=1e-7)
                np.testing.assert_allclose(output['weights'],oracle['weights'],atol=1e-7,rtol=1e-7)
                assert abs(output['variance']/magnitude - .8) < 1e-8
                assert output['normalized_stationarity_residual'] <= 1e-7
                assert output['normalized_dual_violation'] <= 1e-7
                assert output['normalized_complementarity_residual'] <= 1e-8
            for covariance in [[[0,0],[0,0]], [[1,1],[1,1]], [[0,0],[0,1]]]:
                result=await client.call_tool('min_variance',{'request':{'tickers':['A','B'],'covariance':covariance}})
                output=result.structured_content;oracle=active_set_oracle(covariance)
                # Nonunique and boundary solutions compare objectives/certificates, not arbitrary weights.
                assert abs(output['variance']-oracle['variance']) <= 1e-8
                assert output['variance'] >= 0
                assert abs(sum(output['weights'])-1) <= 1e-8
                assert output['normalized_complementarity_residual'] <= 1e-8
            for covariance in [[[-1e-13,0],[0,0]], [[1,0],[0,-1e-14]], [[1e-250,0],[0,1e-250]], [[100,0],[0,-5e-324]], [[100,5e-324],[5e-324,1]]]:
                result=await client.call_tool('min_variance',{'request':{'tickers':['A','B'],'covariance':covariance}},raise_on_error=False)
                assert result.is_error
    asyncio.run(run())


def test_run_identity_is_not_input_identity(monkeypatch):
    output,handshake=asyncio.run(run_mcp())
    import verify
    class FixedClock:
        @classmethod
        def now(cls, tz):
            from datetime import datetime
            return datetime(2026,10,7,tzinfo=tz)
    monkeypatch.setattr(verify,'datetime',FixedClock)
    first=build_evidence(output,handshake)
    second=build_evidence(output,handshake)
    assert first['createdAt'] == second['createdAt']
    assert first['evidenceId'] != second['evidenceId']
    assert first['provenance']['inputSha256'] == second['provenance']['inputSha256']


def test_direct_underflow_rejected():
    for covariance in [[[100,0],[0,-5e-324]], [[100,5e-324],[5e-324,1]]]:
        with pytest.raises(ValueError):
            minimum_variance({'tickers':['A','B'],'covariance':covariance})

def test_positive_diagonal_indefinite_rejected_direct_and_actual_mcp():
    request = {'tickers': ['A', 'B'], 'covariance': [[1, 2], [2, 1]]}
    with pytest.raises(ValueError):
        minimum_variance(request)
    async def run():
        async with Client(transport()) as client:
            result = await client.call_tool('min_variance', {'request': request}, raise_on_error=False)
            assert result.is_error
    asyncio.run(run())
