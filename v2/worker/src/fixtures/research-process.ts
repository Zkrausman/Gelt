// Fixed test child. No artifact-supplied commands or executable configuration.
import { importResearchFile, readResearch } from '../research-store.js';
const [operation, root, input] = process.argv.slice(2);
try {
  if (operation === 'import') process.send?.({ state: importResearchFile(root, input).status });
  else if (operation === 'read') process.send?.(readResearch(root, input));
  else throw new Error('test operation');
} catch { process.send?.({ state: 'unavailable' }); }
process.disconnect?.();
