// Owner-operated CLI only; never run by startup or a network route.
import { provisionOwner } from './provisioning.js';
try {
  provisionOwner(process.argv.slice(2));
  console.log('Provisioned private files. Bootstrap expires in ten minutes; no secrets printed.');
} catch { console.error('Provisioning failed: require supported secure backing, explicit registration and five distinct private directories; no overwrite or unsafe fallback.'); process.exitCode = 1; }
