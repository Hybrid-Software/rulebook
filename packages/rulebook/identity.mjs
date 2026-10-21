import { createHash } from 'node:crypto';

export const text = v => typeof v === 'string' && v.trim().length > 0;
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const strings = v => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
export const dated = v => text(v) && Number.isFinite(Date.parse(v));
export const refKey = (id, revision) => JSON.stringify([id, revision]);
export function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value) && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  throw new TypeError('Expected finite JSON data');
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
