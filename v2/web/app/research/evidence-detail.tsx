import React from 'react';
import type { ResearchRecord } from '../../../worker/src/research-contract';

export function EvidenceDetail({ record }: { record: ResearchRecord }) {
  const e = record.evidence;
  return <article aria-label="Research evidence detail">
    <header><h2>{e.title}</h2><p>Reference computation / non-market evidence</p><p>Evidence ID: {e.evidenceId}. Produced: {e.createdAt}. Imported: {record.importedAt}.</p></header>
    <section aria-labelledby="local-checks"><h3 id="local-checks">Gelt local checks</h3>
      <p>Schema: {record.geltChecks.schema}. Stored original-byte integrity: {record.geltChecks.integrity}.</p>
      <p>Numeric comparison: {record.geltChecks.numericComparison.status}. {record.geltChecks.numericComparison.detail}</p>
      <p>Independent scientific reproduction: {record.geltChecks.scientificReproduction}.</p>
      <p>These checks do not verify source authenticity, inner input/output hashes, dependency installation, producer execution, or investment performance.</p>
      <p>Original SHA-256: {record.originalSha256}. Original bytes: {record.originalBytes}.</p>
    </section>
    <section aria-labelledby="producer-claims"><h3 id="producer-claims">Producer-reported claims</h3>
      <p>Reported by the artifact producer. Separate from Gelt’s local checks; passed claims are not independent verification.</p>
      <dl>{Object.entries(e.producerClaims).map(([name, stage]) => <div key={name}><dt>{name}: {stage.status}</dt><dd>{stage.detail}</dd></div>)}</dl>
    </section>
    <section aria-labelledby="source-pins"><h3 id="source-pins">Sources, pins and licenses</h3>
      <p>Source identifiers below are inert text. Gelt has not fetched or executed them.</p>
      <dl>{Object.entries(e.source).map(([name, source]) => <div key={name}><dt>{name}: {source.title}</dt><dd>{source.identifier}</dd><dd>License: {source.license}</dd>{'commit' in source && <dd>Commit: {source.commit}</dd>}</div>)}</dl>
      <h4>Data provenance</h4><ul>{e.provenance.data.map((source, i) => <li key={i}>{source.title}: {source.identifier}. License: {source.license}</li>)}</ul>
    </section>
    <section aria-labelledby="actual-results"><h3 id="actual-results">Reported output and numeric tolerances</h3>
      <p>Actual and expected values both come from the artifact. When both original tolerances are mathematically zero, local comparison uses exact original decimal values. Otherwise it uses the approximate finite-number formula |actual − expected| ≤ absolute tolerance + relative tolerance × |expected|.</p>
      <p>The table shows decoded numbers, which may round or underflow, including tolerances. Identical displayed values can therefore fail the exact comparison. See Gelt local checks for the comparison counts and basis.</p>
      <div role="region" aria-label="Research numeric results" tabIndex={0} style={{ overflowX: 'auto' }}><table><thead><tr>{['Result', 'Actual', 'Expected', 'Absolute tolerance', 'Relative tolerance'].map(x => <th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{e.results.map((row, i) => <tr key={i}><th scope="row">{row.name}</th><td>{row.actual}</td><td>{row.expected}</td><td>{row.absoluteTolerance}</td><td>{row.relativeTolerance}</td></tr>)}</tbody></table></div>
    </section>
    <section aria-labelledby="inputs-runtime"><h3 id="inputs-runtime">Inputs and reproducibility metadata</h3>
      <p>Adapter: {e.provenance.adapterVersion}. Runtime: {e.provenance.runtime}. Seed: {e.provenance.seed}.</p>
      <p>Producer input SHA-256: {e.provenance.inputSha256}</p><p>Producer output SHA-256: {e.provenance.outputSha256}</p>
      <p>Dependency lock SHA-256: {e.dependencyLock.sha256}</p>
      <ul>{e.dependencyLock.packages.map((p, i) => <li key={i}>{p.name}: {p.version}</li>)}</ul>
      <dl>{e.inputs.map((input, i) => <div key={i}><dt>{input.name} ({input.units})</dt><dd>{input.values.join(', ')}</dd></div>)}</dl>
      <h4>Assumptions</h4><ul>{e.provenance.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </section>
    <section aria-labelledby="recommendation"><h3 id="recommendation">Recommendation: {e.recommendation.decision}</h3>
      <p>Promotion allowed: false. Historical evaluation, shadow observation and cost evaluation: not_run.</p>
      <ul>{e.recommendation.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <h4>Limitations</h4><ul>{e.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <p>This reference computation does not establish a trading strategy, market edge, broker execution, or permission to activate one.</p>
    </section>
  </article>;
}
