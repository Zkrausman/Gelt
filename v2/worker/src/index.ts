import { configuration, createWorker } from './service.js';
import { setup } from './setup.js';
const { host, port } = configuration(process.env);
try {
  const configured = setup(process.env.GELT_WORKER_CONFIG);
  const server = createWorker(configured.connection, configured.serviceSecret, configured.ledger?.available, configured.ledger, configured.ownerId);

  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    configured.connection.shutdown();
    server.close(() => { try { configured.close(); } catch { console.error('Worker secure cleanup unavailable'); process.exitCode = 1; } finally { if (process.connected) process.disconnect(); } }); server.closeAllConnections();
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, stop);
  process.on('message', message => { if ((message as { type?: string })?.type === 'gelt:shutdown') stop(); });
  process.on('disconnect', stop);
  server.once('error', () => { console.error('Worker listener unavailable'); process.exitCode = 1; stop(); });
  server.listen(port, host, () => console.log('Execution-disabled worker listening'));
} catch { console.error('Worker secure setup unavailable'); process.exitCode = 1; }
