import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Gelt — Evidence workspace', template: '%s | Gelt' },
  description: 'Candidate evidence, readiness boundaries and recorded results. Trading disabled.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <a className="gelt-skip" href="#gelt-content">Skip to content</a>
    <header className="gelt-header"><Link className="gelt-brand" href="/">Gelt</Link>
      <nav aria-label="Gelt navigation"><Link href="/research">Evidence</Link><Link href="/orders">Readiness</Link><Link href="/simulation">Recorded results</Link><Link href="/history">History</Link><Link href="/connect">Owner session</Link></nav>
      <span className="gelt-disabled">Trading disabled</span>
    </header>
    <div id="gelt-content" tabIndex={-1}>{children}</div>
  </body></html>;
}
