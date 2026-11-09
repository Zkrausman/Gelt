import * as fs from 'node:fs';
import { dirname, resolve, parse, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { windowsStorage } from './windows-storage.js';
// Linux UID/mode contract. No platform or key fallback.
export function privateDirectory(path: string) {
  if (process.platform === 'win32') { windowsStorage('directory', path); return; }
  if (process.platform !== 'linux' || !process.getuid || path !== resolve(path)) throw new Error('secure storage unavailable');
  let p = path;
  while (true) {
    const st = fs.lstatSync(p);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('unsafe directory');
    if (p === path) {
      if (st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700) throw new Error('unsafe directory');
    } else if ((st.uid !== 0 && st.uid !== process.getuid()) || ((st.mode & 0o022) !== 0 && !(st.uid === 0 && (st.mode & 0o1000)))) throw new Error('unsafe ancestor');
    if (p === parse(p).root) break;
    p = dirname(p);
  }
}
export function readPrivate(path: string, max = 65536, nonblocking = false): Buffer {
  if (nonblocking && process.platform !== 'linux') throw new Error('secure storage unavailable');
  if (process.platform === 'win32') return windowsStorage('read', path, Buffer.alloc(0), max);
  privateDirectory(dirname(path));
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | (nonblocking ? fs.constants.O_NONBLOCK : 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid!() || (st.mode & 0o777) !== 0o600 || st.size > max) throw new Error('unsafe file');
    if (!nonblocking) return fs.readFileSync(fd);
    const named = fs.lstatSync(path);
    if (named.dev !== st.dev || named.ino !== st.ino || !Number.isSafeInteger(max) || max < 0) throw new Error('unsafe file');
    const bytes = Buffer.alloc(Math.min(st.size, max) + 1);
    let size = 0;
    while (size < bytes.length) { const n = fs.readSync(fd, bytes, size, bytes.length - size, size); if (!n) break; size += n; }
    const after = fs.fstatSync(fd), current = fs.lstatSync(path);
    if (size !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.nlink !== 1
      || current.dev !== st.dev || current.ino !== st.ino) throw new Error('unsafe file');
    return bytes.subarray(0, size);
  } finally { fs.closeSync(fd); }
}
export function syncDirectory(path: string, nonblocking = false) {
  if (process.platform === 'win32') throw new Error('POSIX directory sync unsupported');
  const fd = fs.openSync(path, nonblocking ? fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK : 'r');
  try {
    if (nonblocking) {
      privateDirectory(path);
      const st = fs.fstatSync(fd), named = fs.lstatSync(path);
      if (!st.isDirectory() || st.dev !== named.dev || st.ino !== named.ino) throw new Error('unsafe directory');
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

// All private creation/mutation goes through these primitives on both platforms.
export function createPrivateDirectory(path: string) {
  if (process.platform === 'win32') { windowsStorage('mkdir', path); return; }
  fs.mkdirSync(path, { mode: 0o700 }); privateDirectory(path);
}
export function writePrivateNew(path: string, value: string | Buffer, nonblocking = false) {
  if (process.platform === 'win32') { windowsStorage('new', path, Buffer.from(value)); return; }
  privateDirectory(dirname(path));
  const fd = fs.openSync(path, 'wx', 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(dirname(path), nonblocking);
}
export function replacePrivate(path: string, value: string | Buffer) {
  if (process.platform === 'win32') { windowsStorage('replace', path, Buffer.from(value)); return; }
  privateDirectory(dirname(path));
  try { readPrivate(path, 150000); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const tmp = path + '.' + randomBytes(16).toString('hex');
  try { writePrivateNew(tmp, value); fs.renameSync(tmp, path); syncDirectory(dirname(path)); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function removePrivate(path: string, nonblocking = false) {
  if (process.platform === 'win32') { windowsStorage('remove', path); return; }
  readPrivate(path, 150000, nonblocking); fs.unlinkSync(path); syncDirectory(dirname(path), nonblocking);
}
export function separateDirectories(a: string, b: string) {
  const normalize = (p: string) => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
  a = normalize(a); b = normalize(b);
  return a !== b && !a.startsWith(b + sep) && !b.startsWith(a + sep);
}
// The persistent marker is intentionally not automatically stolen after a crash.
// Compare under ownership and commit a consumed tombstone before issuing a session.
export function consumePrivate(path: string, expected: Buffer) {
  const lock = path + '.lock'; writePrivateNew(lock, 'owned');
  try {
    if (!readPrivate(path).equals(expected)) throw new Error('grant changed');
    if (process.platform === 'win32') replacePrivate(path, '{"consumed":true}');
    else removePrivate(path);
  } catch { throw new Error('grant unavailable'); } // retain uncertain-state evidence
  removePrivate(lock);
}
