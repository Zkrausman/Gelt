import React from 'react';
import Link from 'next/link';

const steps = [
  { number: '01', title: 'Candidate & evidence', href: '/research', action: 'Inspect research evidence', description: 'Read retained source, method, comparison and provenance evidence. A retained artifact is not an admitted strategy or an automatic paper conversion.' },
  { number: '02', title: 'Readiness', href: '/orders', action: 'Inspect protected status', description: 'Read the protected connection and execution boundary. Unknown evidence stays unknown; an account connection does not enable trading.' },
  { number: '03', title: 'Recorded results', href: '/simulation', action: 'View recorded results', description: 'Inspect scripted synthetic fixtures, observed mock fills and uncertainty. These are recorded test results, not a live shadow campaign or strategy performance.' },
];

export default function Home() {
  return <main className="gelt-home">
    <header className="gelt-intro"><p className="gelt-eyebrow">GELT WORKSPACE</p><h1>Evidence before execution.</h1>
      <p>A focused workspace for candidates, readiness and recorded results. Inspect the evidence behind each step.</p>
    </header>
    <section className="gelt-boundary" aria-label="Source safety boundary">
      <strong>SAFETY GATE — trading is disabled</strong>
      <p>Qualification NOT_READY · production CLOSED · operations DEFER.</p>
      <p>C07 / C13 / C14 remain UNKNOWN. These are the current source limits, not a live runtime or account-health report. No market data, balances, signals or risk measurements are inferred here.</p>
    </section>
    <section aria-label="Evidence workflow" className="gelt-steps">{steps.map(step => <article key={step.number}>
      <p className="gelt-eyebrow">{step.number}</p><h2>{step.title}</h2><p>{step.description}</p><Link href={step.href}>{step.action} →</Link>
    </article>)}</section>
    <section className="gelt-support" aria-label="Supporting views"><h2>Supporting records</h2>
      <p><Link href="/history">Order history & timeline</Link> — recorded ledger facts, with requests, acknowledgements and fills kept distinct.</p>
      <p><Link href="/connect">Owner session & connection</Link> — existing protected setup and account-selection controls.</p>
      <p>Start with a permitted viewer session when a protected view requires one. Viewing evidence grants no order or promotion authority.</p>
    </section>
  </main>;
}
