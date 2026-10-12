import { researchCLI } from './research-cli.js';
try { researchCLI(process.argv.slice(2)); }
catch { console.error('Research operation failed. Require separately provisioned private storage and a bounded, explicit regular JSON file; existing evidence is never overwritten. Interrupted writes require owner review.'); process.exitCode = 1; }
