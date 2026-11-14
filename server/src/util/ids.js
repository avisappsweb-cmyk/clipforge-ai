import crypto from 'node:crypto';

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}
