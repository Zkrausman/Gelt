# Attribution and scope

This adapter uses Robert Andrew Martin's PyPortfolioOpt 1.6.0, MIT licensed.
The four-by-four covariance fixture is copied from
`tests/test_efficient_frontier.py::test_min_volatility_vs_max_sharpe` at
commit `0186e707a0d2ec03406608d3400539d0f140c625`. The upstream MIT copyright
and license are retained in `licenses/PyPortfolioOpt-MIT.txt`.

Paper: Martin (2021), *PyPortfolioOpt: portfolio optimization in Python*,
Journal of Open Source Software, DOI https://doi.org/10.21105/joss.03066,
CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
The paper's historical software archive is v1.4.1,
https://doi.org/10.5281/zenodo.4740186. This implementation instead uses the
modern 1.6.0 release, explicitly distinguished from that historical archive.
No paper text or figure is reproduced.

Paper2Agent workflow: https://github.com/jmiao24/Paper2Agent at
`8c2d059165ef8cdcb70dbea76655b9c2b55b38e6`, MIT. Reviewed the root
`skills/paper2agent/SKILL.md` and `paper2mcp/SKILL.md` as workflow sources.
This is a bounded host-agent adaptation of source reuse, independent numerical
verification, and real MCP runtime testing. It is not an installed standalone
Paper2Agent model service, nor a claim to have completed every upstream skill,
workflow-state marker, independent delivery gate, or ZIP requirement.
The upstream license is retained in `licenses/Paper2Agent-MIT.txt`.

FastMCP 4.0.3 / fastmcp-slim 4.0.3 are Apache-2.0; CLARABEL 0.11.1 is
Apache-2.0. Installed distribution license texts are retained under `licenses/`.
All dependencies are separately distributed through the official PyPI registry;
the checked-in uv.lock records exact resolved versions, wheel/source URLs and
SHA256s. No upstream package source is vendored beyond the attributed fixture.
