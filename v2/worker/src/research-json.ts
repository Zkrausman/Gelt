// JSON.parse alone silently accepts duplicate object keys. Validate syntax and
// duplicate keys before decoding, with structural bounds independent of Zod.
export type ResearchResultNumbers = Partial<Record<'actual' | 'expected' | 'absoluteTolerance' | 'relativeTolerance', string>>;

export function parseResearchJSON(bytes: Buffer): unknown {
  return parse(bytes);
}

// Capture only result-number tokens from the SAME strict parse as the decoded
// value. Array indices and decoded keys bind tokens without relying on text search.
export function parseResearchEvidenceJSON(bytes: Buffer): { value: unknown; numbers: ResearchResultNumbers[] } {
  const numbers: ResearchResultNumbers[] = [];
  const value = parse(bytes, (path, token) => {
    if (path.length === 3 && path[0] === 'results' && typeof path[1] === 'number' &&
        ['actual', 'expected', 'absoluteTolerance', 'relativeTolerance'].includes(String(path[2]))) {
      const row = numbers[path[1]] ??= {};
      row[path[2] as keyof ResearchResultNumbers] = token;
    }
  });
  return { value, numbers };
}

function parse(bytes: Buffer, numberToken?: (path: (string | number)[], token: string) => void): unknown {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let at = 0, nodes = 0;
  const fail = (): never => { throw new Error('invalid research JSON'); };
  const space = () => { while (/[\x20\t\r\n]/.test(source[at] ?? '') && at < source.length) at++; };
  function string(): string {
    const start = at++;
    while (at < source.length) {
      const c = source[at++];
      if (c === '"') return JSON.parse(source.slice(start, at));
      if (c === '\\') at++;
    }
    return fail();
  }
  function value(depth: number, path: (string | number)[]): void {
    if (depth > 16 || ++nodes > 20_000) fail();
    space();
    const c = source[at];
    if (c === '"') { string(); return; }
    if (c === '{' || c === '[') {
      at++;
      const end = c === '{' ? '}' : ']';
      const keys = new Set<string>();
      let index = 0;
      space();
      if (source[at] === end) { at++; return; }
      while (true) {
        space();
        let key: string | number = index++;
        if (c === '{') {
          if (source[at] !== '"') fail();
          key = string();
          if (keys.has(key)) fail();
          keys.add(key); space();
          if (source[at++] !== ':') fail();
        }
        value(depth + 1, [...path, key]); space();
        if (source[at] === end) { at++; return; }
        if (source[at++] !== ',') fail();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(at));
    if (!token) fail();
    if (/[-0-9]/.test(token![0][0])) numberToken?.(path, token![0]);
    at += token![0].length;
  }
  value(0, []); space();
  if (at !== source.length) fail();
  return JSON.parse(source);
}
