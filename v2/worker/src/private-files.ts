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
export function readPrivate(path: string, max = 65536): Buffer {
  if (process.platform === 'win32') return windowsStorage('read', path, Buffer.alloc(0), max);
  privateDirectory(dirname(path));
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid!() || (st.mode & 0o777) !== 0o600 || st.size > max) throw new Error('unsafe file');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
export function syncDirectory(path: string) { if (process.platform === 'win32') throw new Error('POSIX directory sync unsupported'); const fd = fs.openSync(path, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

// All private creation/mutation goes through these primitives on both platforms.
export function createPrivateDirectory(path: string) {
  if (process.platform === 'win32') { windowsStorage('mkdir', path); return; }
  fs.mkdirSync(path, { mode: 0o700 }); privateDirectory(path);
}
export function writePrivateNew(path: string, value: string | Buffer) {
  if (process.platform === 'win32') { windowsStorage('new', path, Buffer.from(value)); return; }
  privateDirectory(dirname(path));
  const fd = fs.openSync(path, 'wx', 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(dirname(path));
}
export function replacePrivate(path: string, value: string | Buffer) {
  if (process.platform === 'win32') { windowsStorage('replace', path, Buffer.from(value)); return; }
  privateDirectory(dirname(path));
  try { readPrivate(path, 150000); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const tmp = path + '.' + randomBytes(16).toString('hex');
  try { writePrivateNew(tmp, value); fs.renameSync(tmp, path); syncDirectory(dirname(path)); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function removePrivate(path: string) {
  if (process.platform === 'win32') { windowsStorage('remove', path); return; }
  readPrivate(path, 150000); fs.unlinkSync(path); syncDirectory(dirname(path));
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
