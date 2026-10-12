"""Local trusted reference execution, stdio protocol verification, and evidence export."""
import asyncio
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import sys
import tomllib
import uuid

import numpy as np
from pypfopt import EfficientFrontier
from fastmcp import Client
from fastmcp.client.transports import StdioTransport
from adapter import FIXTURE, SOLVER_OPTIONS
from oracle import active_set_oracle

ROOT = Path(__file__).resolve().parent
COMMIT = '0186e707a0d2ec03406608d3400539d0f140c625'
WORKFLOW_COMMIT = '8c2d059165ef8cdcb70dbea76655b9c2b55b38e6'
def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('utf-8')
def digest(value):return hashlib.sha256(canonical(value)).hexdigest()
def transport():
    return StdioTransport(command='/usr/bin/env',args=['-i','PATH=/usr/bin:/bin','HOME=/tmp','PYTHONNOUSERSITE=1','FASTMCP_CHECK_FOR_UPDATES=off',sys.executable,str(ROOT/'server.py')],cwd=str(ROOT),env={},keep_alive=False)
async def run_mcp():
    async with Client(transport()) as client:
        names=[t.name for t in await client.list_tools()]
        if names != ['min_variance']:raise ValueError('unexpected exposed tools')
        result=await client.call_tool('min_variance',{'request':FIXTURE})
        if result.is_error:raise ValueError('MCP tool returned error')
        return result.structured_content, {'protocol':client.protocol_version,'server':client.server_info.model_dump(mode='json'),'tools':names}

def source_reference():
    # Deliberately does not call adapter.minimum_variance.
    c=np.array(FIXTURE['covariance']); scale=float(np.max(np.abs(c)))
    ef=EfficientFrontier(None,c/scale,weight_bounds=(0,1),solver='CLARABEL',solver_options=SOLVER_OPTIONS)
    ef.min_volatility()
    weights=ef._w.value.tolist()
    return {'weights':weights,'variance':float(np.array(weights)@np.array(FIXTURE['covariance'])@np.array(weights))}

def build_evidence(output,handshake):
    direct=source_reference(); oracle=active_set_oracle(FIXTURE['covariance'])
    results=[]
    def compare(name,actual,expected,atol=1e-7,rtol=1e-7):
        if abs(actual-expected)>atol+rtol*abs(expected):raise ValueError(f'comparison failed: {name}')
        results.append(dict(name=name,actual=float(actual),expected=float(expected),absoluteTolerance=atol,relativeTolerance=rtol))
    for i,ticker in enumerate(FIXTURE['tickers']):
        compare(f'mcp_weight_{ticker}_vs_independent_oracle',output['weights'][i],oracle['weights'][i])
        compare(f'mcp_weight_{ticker}_vs_direct_source',output['weights'][i],direct['weights'][i],1e-12,1e-12)
    compare('mcp_variance_vs_independent_oracle',output['variance'],oracle['variance'],1e-10,1e-7)
    compare('mcp_variance_vs_direct_source',output['variance'],direct['variance'],1e-14,1e-12)
    for name in ['budget_residual','bound_violation']:compare(name,output[name],0.,1e-8,0.)
    for name in ['stationarity_residual','dual_violation','complementarity_residual']:compare('oracle_'+name,oracle[name],0.,1e-10,0.)
    # Evaluate KKT at the actual MCP result, not just at the oracle.
    c=np.array(FIXTURE['covariance']);w=np.array(output['weights']);g=2*c@w
    active=w>1e-6;lagrange=float(np.mean(g[active]));dual=g-lagrange
    compare('mcp_stationarity_residual',max(abs(dual[active])),0.,1e-8,0.)
    compare('mcp_dual_violation',max(0.,-min(dual)),0.,1e-8,0.)
    compare('mcp_complementarity_residual',max(abs(w*dual)),0.,1e-8,0.)
    lock=tomllib.loads((ROOT/'uv.lock').read_text())
    packages=[{'name':p['name'],'version':p['version']} for p in lock['package'] if p.get('source',{}).get('registry')]
    not_run=lambda what:{'status':'not_run','detail':what+' not run; no measured metric.'}
    created_at=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    nonce=str(uuid.uuid4())
    adapter_source=digest({name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['adapter.py','server.py','oracle.py','verify.py']})
    run_id=digest({'nonce':nonce,'createdAt':created_at,'input':FIXTURE,'output':output,'upstream':COMMIT,'adapterSource':adapter_source,'lock':hashlib.sha256((ROOT/'uv.lock').read_bytes()).hexdigest()})[:24]
    return {'schema':'gelt.research-evidence.v1','kind':'reference_computation',
      'evidenceId':'pyportfolioopt-min-variance-'+run_id,
      'createdAt':created_at,
      'title':'PyPortfolioOpt fixed-reference minimum variance via real stdio MCP',
      'source':{'paper':{'title':'Martin (2021), PyPortfolioOpt: portfolio optimization in Python','identifier':'doi:10.21105/joss.03066; historical paper archive v1.4.1 doi:10.5281/zenodo.4740186','license':'CC-BY-4.0'},
       'code':{'title':'PyPortfolioOpt v1.6.0 (modern runtime, not original paper release)','identifier':'https://github.com/robertmartin8/PyPortfolioOpt/tree/'+COMMIT,'license':'MIT','commit':COMMIT},
       'paper2agent':{'title':'Paper2Agent host-agent workflow, manually scoped reviewed reference integration','identifier':'https://github.com/jmiao24/Paper2Agent/tree/'+WORKFLOW_COMMIT,'license':'MIT','commit':WORKFLOW_COMMIT}},
      'inputs':[{'name':'covariance_row_major_AGG_SPY_GLD_HYG','values':sum(FIXTURE['covariance'],[]),'units':'unverified fixture covariance units'}],
      'dependencyLock':{'sha256':hashlib.sha256((ROOT/'uv.lock').read_bytes()).hexdigest(),'packages':packages},
      'results':results,
      'provenance':{'adapterVersion':'0.2.0','runtime':'CPython '+platform.python_version(),'seed':0,'inputSha256':digest(FIXTURE),'outputSha256':digest(output),
        'data':[{'title':'Fixed reference matrix from test_min_volatility_vs_max_sharpe; ETF labels do not establish market provenance','identifier':'https://github.com/robertmartin8/PyPortfolioOpt/blob/'+COMMIT+'/tests/test_efficient_frontier.py','license':'MIT'}],
        'assumptions':['Tickers and covariance rows/columns ordered AGG, SPY, GLD, HYG. Matrix is symmetric PSD. Objective is divided by max absolute covariance entry before optimization; raw variance preserves original units.','No market source, observation dates, return frequency, or annualization is verified. Do not interpret variance as annualized risk.','Long-only, fully invested; no expected returns, cash, transaction costs or trading execution.','CLARABEL '+output['solver_version']+'; optimal; options='+json.dumps(output['solver_options'],sort_keys=True)+'; iterations='+str(output['iterations']),
        'Actual stdio discovery handshake: protocol '+handshake['protocol']+'; server FastMCP '+importlib.metadata.version('fastmcp')+'; tool min_variance.',
        'Input/output hashes use UTF-8 JSON, sorted keys, compact separators, ensure_ascii=True, allow_nan=False. Output hash covers the full raw tool result archived alongside this evidence.',
        'Independent oracle enumerates all simplex active sets and solves equality KKT systems with numpy.linalg.lstsq; no PyPortfolioOpt/CVXPY solver call.',
        'Canonical raw MCP output JSON: '+canonical(output).decode('ascii'),
        'Run identity nonce: '+nonce+'; adapter source SHA256: '+adapter_source+'. Source digest is canonical JSON of SHA256 hex digests for adapter.py, server.py, oracle.py and verify.py.',
        'Seed 0 is a provenance placeholder: this deterministic calculation uses no random generator.']},
      'producerClaims':{'reference':{'status':'passed','detail':'Pinned PyPortfolioOpt direct call matches actual MCP call; reviewed installed optimization files match source commit.'},
        'mcp':{'status':'passed','detail':'Actual stdio discovery, tool listing, schema validation and min_variance call succeeded.'},
        'reproduction':{'status':'passed','detail':'Fixed numerical reference only: independent active-set/KKT oracle and direct source comparison pass. No paper-wide scientific replication claim.'},
        'historical':not_run('Historical backtest'),'costs':not_run('Cost/slippage analysis'),'shadow':not_run('Shadow observation')},
      'limitations':['Fixed non-market reference fixture only; ETF symbols are labels and do not verify market provenance.','Modern v1.6.0 source is not the v1.4.1 paper archive. Only one minimum-variance computation is verified.','Paper2Agent workflow was read and selectively applied by the host agent; no autonomous paper ingestion or paid model campaign was run.','Reviewed trusted local code execution with scrubbed subprocess environment is not a general untrusted-code sandbox.','Evidence import is inert; producer hashes and claims are not independently reproduced by Gelt.'],
      'recommendation':{'decision':'insufficient_evidence','promotionAllowed':False,'reasons':['No historical out-of-sample results, transaction costs, shadow observations, or live-market validation.']}}

async def main():
    output,handshake=await run_mcp(); evidence=build_evidence(output,handshake)
    encoded=canonical(evidence)+b'\n'
    if len(encoded)>65536:raise ValueError('evidence exceeds import limit')
    destination=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'artifacts'
    destination.mkdir(parents=True,exist_ok=True)
    # Exclusive creation makes immutable evidence an explicit one-shot export.
    for name,data in [('evidence.json',encoded),('mcp-output.json',canonical(output)+b'\n'),('mcp-handshake.json',canonical(handshake)+b'\n')]:
        with (destination/name).open('xb') as f:f.write(data)
    print(json.dumps({'evidence':str(destination/'evidence.json'),'sha256':hashlib.sha256(encoded).hexdigest(),'bytes':len(encoded),'checks':len(evidence['results'])}))
if __name__=='__main__':asyncio.run(main())
