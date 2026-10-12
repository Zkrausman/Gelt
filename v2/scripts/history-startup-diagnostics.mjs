const MAX_DIAGNOSTIC_CHARS = 1200;
export const BROWSER_DISCOVERY_TIMEOUT_MS = 3000;
const CREDENTIAL_KEY = '(?:authorization|access|refresh|csrf|bootstrap|secret|state|session|code|(?:access|refresh|csrf|bootstrap|service|session)[_-]?(?:token|secret)|password|credential|api[_-]?key)';
const CREDENTIAL_ASSIGNMENT = new RegExp(`((?:"|'|\\b)${CREDENTIAL_KEY}(?:"|'|\\b)[ \\t]*[:=][ \\t]*)[^\\r\\n]*`, 'gi');
const QUOTED_ASSIGNMENT = /^([ \t]*(?:"[^"\r\n]+"|'[^'\r\n]+')[ \t]*[:=][ \t]*)[^\r\n]*/gm;

function normalizeSecrets(secrets) {
  const values = typeof secrets === 'string' ? [secrets] : [...(secrets ?? [])];
  return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))].sort((a, b) => b.length - a.length);
}

function sanitizeText(value, secrets = []) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  for (const secret of normalizeSecrets(secrets)) {
    text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/(?:https?|wss?|file):\/\/[^\s"'<>)]*/gi, '[url]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\b(?:request|response)?[_ -]?body\s*[:=][^\r\n]*/gi, 'body=[omitted]')
    .replace(/\{[^\r\n]*\}/g, '[structured data omitted]')
    .replace(/([?&](?:access[_-]?token|refresh[_-]?token|csrf|bootstrap|secret|password|authorization|code|state|session)[^=&#]*=)[^&#\s]*/gi, '$1[redacted]')
    .replace(CREDENTIAL_ASSIGNMENT, '$1[redacted]')
    .replace(QUOTED_ASSIGNMENT, '$1[redacted]');
}

function tail(text, limit) {
  if (limit === 0) return '';
  return text.length <= limit ? text : text.slice(-limit);
}

export function createBoundedTextBuffer(limit = MAX_DIAGNOSTIC_CHARS) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('bounded text limit must be a nonnegative integer');
  return { limit: Math.min(MAX_DIAGNOSTIC_CHARS, limit), output: '', pending: '', discarding: false, secrets: [] };
}

function appendSafeUnit(buffer, unit) {
  if (unit.length > MAX_DIAGNOSTIC_CHARS) {
    buffer.output = tail(`${buffer.output}[overlong stderr unit omitted]\n`, buffer.limit);
    return;
  }
  buffer.output = tail(buffer.output + sanitizeText(unit, buffer.secrets), buffer.limit);
}

export function appendBoundedText(buffer, chunk, secrets = []) {
  if (!buffer || typeof buffer !== 'object' || typeof buffer.output !== 'string' || typeof buffer.pending !== 'string' || typeof buffer.discarding !== 'boolean' || !Number.isSafeInteger(buffer.limit)) {
    throw new TypeError('bounded text buffer required');
  }
  buffer.secrets = normalizeSecrets([...buffer.secrets, ...normalizeSecrets(secrets)]);
  let text = buffer.pending + String(chunk ?? '');
  buffer.pending = '';
  if (buffer.discarding) {
    const newline = text.indexOf('\n');
    if (newline === -1) return buffer;
    text = text.slice(newline + 1);
    buffer.discarding = false;
  }
  let start = 0;
  let newline;
  while ((newline = text.indexOf('\n', start)) !== -1) {
    appendSafeUnit(buffer, text.slice(start, newline + 1));
    start = newline + 1;
  }
  buffer.pending = text.slice(start);
  if (buffer.pending.length > MAX_DIAGNOSTIC_CHARS) {
    buffer.pending = '';
    buffer.discarding = true;
    buffer.output = tail(`${buffer.output}[overlong stderr unit omitted]\n`, buffer.limit);
  }
  return buffer;
}

export function readBoundedText(buffer, secrets = []) {
  if (!buffer || typeof buffer !== 'object' || typeof buffer.output !== 'string' || typeof buffer.pending !== 'string' || typeof buffer.discarding !== 'boolean' || !Number.isSafeInteger(buffer.limit)) {
    throw new TypeError('bounded text buffer required');
  }
  const knownSecrets = normalizeSecrets([...buffer.secrets, ...normalizeSecrets(secrets)]);
  // Pending text has no line boundary, so generic credential patterns may be incomplete.
  // Never include it in a failure snapshot; a later newline will make it sanitizable.
  return tail(sanitizeText(buffer.output, knownSecrets), buffer.limit);
}

function redact(value, secrets = [], limit = MAX_DIAGNOSTIC_CHARS) {
  let text = sanitizeText(value, secrets);
  if (text.length > limit) text = `${text.slice(-(limit - 14))} [truncated]`;
  return text;
}

function errorText(error, secrets) {
  if (!error || typeof error !== 'object') return 'Error';
  const name = typeof error.name === 'string' && /^[A-Za-z][A-Za-z0-9]*Error$/.test(error.name) ? error.name : 'Error';
  const code = typeof error.code === 'string' && /^[A-Z0-9_-]{1,40}$/.test(error.code) ? ` code=${error.code}` : '';
  return `${name}${code}`;
}

function childState(child) {
  if (!child) return 'not-started';
  if (child.spawnError) {
    const code = typeof child.spawnError.code === 'string' && /^[A-Z0-9_-]{1,40}$/.test(child.spawnError.code) ? child.spawnError.code : 'unknown';
    return `spawn-error(code=${code})`;
  }
  if (!Object.hasOwn(child, 'process') || child.process === undefined || child.process === null) return 'not-started';
  const process = child.process;
  if (process.exitCode !== null && process.exitCode !== undefined) return `exited(code=${process.exitCode})`;
  if (process.signalCode !== null && process.signalCode !== undefined) return `exited(signal=${process.signalCode})`;
  const pid = Number.isSafeInteger(process.pid) ? process.pid : 'unknown';
  return `running(pid=${pid}, connected=${Boolean(process.connected)})`;
}

function requestState(request, secrets) {
  if (!request) return 'none';
  const label = redact(request.label ?? 'startup request', secrets, 100);
  const outcome = redact(request.outcome ?? 'unknown', secrets, 100);
  const attempts = Number.isSafeInteger(request.attempts) && request.attempts >= 0 ? request.attempts : 0;
  const status = Number.isInteger(request.status) && request.status >= 100 && request.status <= 599 ? request.status : 'none';
  const processStatus = Number.isInteger(request.processStatus) ? ` processStatus=${request.processStatus}` : '';
  return `${label} outcome=${outcome} attempts=${attempts} status=${status}${processStatus}`;
}

export async function discoverBrowserPage(port, {
  fetchImpl = globalThis.fetch,
  timeoutSignal = milliseconds => AbortSignal.timeout(milliseconds),
  onRequest,
} = {}) {
  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { signal: timeoutSignal(BROWSER_DISCOVERY_TIMEOUT_MS) });
  } catch (error) {
    onRequest?.({ label: 'Browser DevTools target list', outcome: 'network-error', status: null, attempts: 1, error });
    throw error;
  }
  onRequest?.({ label: 'Browser DevTools target list', outcome: response.ok ? 'http-ok' : 'http-error', status: response.status, attempts: 1 });
  const pages = await response.json();
  const page = Array.isArray(pages) ? pages.find(item => item.type === 'page') : null;
  if (!page?.webSocketDebuggerUrl) throw Error('owned browser page must expose CDP');
  return page;
}

export function formatStartupFailure({
  error,
  reason,
  phase,
  startedAt,
  now = Date.now(),
  deadlineAt,
  children = {},
  request,
  secrets = [],
}) {
  const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(now) ? Math.max(0, Math.floor(now - startedAt)) : 0;
  const remainingMs = Number.isFinite(deadlineAt) && Number.isFinite(now) ? Math.max(0, Math.floor(deadlineAt - now)) : 'unknown';
  const details = [
    `FAIL history browser acceptance: phase=${redact(phase ?? 'unknown', secrets, 120)} elapsed=${elapsedMs}ms globalDeadlineRemaining=${remainingMs}ms`,
    ...(reason ? [`Failure category: ${redact(reason, secrets, 120)}`] : []),
    `Error: ${errorText(error, secrets)}`,
    `Owned children: ${Object.entries(children).map(([name, value]) => `${redact(name, secrets, 80)}=${childState(value)}`).join('; ') || 'none'}`,
    `Last startup request: ${requestState(request, secrets)}`,
  ];
  for (const [name, value] of Object.entries(children)) {
    const stderr = redact(value?.stderr ?? '', secrets, MAX_DIAGNOSTIC_CHARS);
    if (stderr) details.push(`stderr ${redact(name, secrets, 80)} (bounded to ${MAX_DIAGNOSTIC_CHARS} chars): ${stderr}`);
  }
  return details.join('\n');
}

export const diagnosticLimits = Object.freeze({ maxChars: MAX_DIAGNOSTIC_CHARS });
