// Renew only owner login, not OAuth or service/vault material.
import { renewGrant } from './provisioning.js';
try {
  renewGrant(process.argv.slice(2));
  console.log('Private one-use owner grant provisioned; expires in ten minutes.');
} catch { console.error('Owner grant unavailable; use explicit separate private directories and remove only your previously consumed/expired grant files.'); process.exitCode = 1; }
