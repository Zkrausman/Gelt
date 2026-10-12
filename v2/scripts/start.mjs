import { launch, ready } from './runtime.mjs';
const group = launch();
let interrupted = false;
const stop = () => { interrupted = true; void group.stop(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
process.on('message', message => { if (message?.type === 'gelt:shutdown') stop(); });
process.on('disconnect', stop);
try {
  await ready(group);
  console.log('Execution-disabled local services ready: web 3000, market 4000, disabled worker 4100 (127.0.0.1 only)');
  await group.exited;
  if (!interrupted) throw new Error('Foundation child exited');
} catch (error) { if (!interrupted) { console.error(error); process.exitCode = 1; } }
finally { await group.stop(); if (process.connected) process.disconnect(); }
