// Owner-operated local CLI. Not imported by worker startup or any network route.
import { importResearchFile, provisionResearch } from './research-store.js';

export function researchCLI(args: string[]): void {
  const [operation, ...values] = args;
  if (operation === 'provision' && values.length === 6) {
    provisionResearch(values[0], values.slice(1));
    console.log('Provisioned separate private research storage.');
    return;
  }
  if (operation === 'import' && values.length === 2) {
    const result = importResearchFile(values[0], values[1]);
    console.log(JSON.stringify({ status: result.status, evidenceId: result.record.evidence.evidenceId,
      originalSha256: result.record.originalSha256, recommendation: 'insufficient_evidence', promotionAllowed: false }));
    return;
  }
  throw new Error('invalid research operation');
}
