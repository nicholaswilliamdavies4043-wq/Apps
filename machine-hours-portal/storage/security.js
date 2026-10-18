/* Password hashing, one-time setup codes and sign-in throttling for superusers. */
'use strict';
const crypto = require('crypto');

const N = 16384, KEYLEN = 64;
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, KEYLEN, { N }).toString('hex');
  return { salt, hash, algo: 'scrypt', updatedAt: Date.now() };
}
function verifyPassword(pw, cred) {
  if (!cred || !cred.salt || !cred.hash) return false;
  const h = crypto.scryptSync(String(pw), cred.salt, KEYLEN, { N });
  const want = Buffer.from(cred.hash, 'hex');
  return want.length === h.length && crypto.timingSafeEqual(h, want);
}
function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}

// Setup codes look like K7QH-2M9X-TR4P (no 0/O/1/I to avoid typos). Only a hash is stored.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHA[b[i] % ALPHA.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
}
const codeHash = (c) => crypto.createHash('sha256').update(String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
function issueCode(db, email, days) {
  const code = newCode();
  db.security.codes[email] = { hash: codeHash(code), expires: Date.now() + (days || 7) * 86400000, createdAt: Date.now() };
  return code;
}
function checkCode(db, email, code) {
  const c = db.security.codes[email];
  if (!c || c.expires < Date.now()) return false;
  const a = Buffer.from(c.hash, 'hex'), b = Buffer.from(codeHash(code), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 5 wrong attempts per email → locked for 15 minutes
const attempts = new Map();
function locked(email) {
  const a = attempts.get(email);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 60000) : 0;
}
function failed(email) {
  const a = attempts.get(email) || { n: 0, until: 0 };
  a.n++;
  if (a.n >= 5) { a.until = Date.now() + 15 * 60000; a.n = 0; }
  attempts.set(email, a);
}
function succeeded(email) { attempts.delete(email); }

module.exports = { hashPassword, verifyPassword, passwordProblem, issueCode, checkCode, locked, failed, succeeded };
