// EED HALAL — encryption for the customer's personal data.
//
// WHY: the phone number, tax id and address are personal data under PDPA
// (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562). They are stored in the
// database on the owner's machine, so a copy of that file (a backup, a
// screenshot, a stolen laptop) would hand over every customer's details.
//
// The shop's own conversation text is NOT encrypted: the whole point of the
// conversation is that the owner can read it, and the drafts are the business
// record. What is encrypted is the identity data the owner entered once.
//
// HOW
// - AES-256-GCM with a key derived from EED_DATA_KEY (scrypt, constant salt).
// - Every value gets its own random IV, and the result is marked with a
//   prefix so an old plaintext row still reads back as it is.
// - Without EED_DATA_KEY nothing is encrypted: the shop keeps working, and
//   the owner is told that the data is stored in plain text.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const PREFIX = 'enc:v1:';
const SALT = 'eedhalal-pii-v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** The fields that identify a person and are therefore encrypted at rest. */
export const PII_FIELDS = Object.freeze(['phone', 'email', 'companyName', 'taxId', 'address', 'notes']);

export function encryptionKey(env = process.env) {
  const secret = env.EED_DATA_KEY;
  if (!secret || !String(secret).trim()) return null;
  return scryptSync(String(secret).trim(), SALT, KEY_LENGTH);
}

export function encryptionEnabled(env = process.env) {
  return encryptionKey(env) !== null;
}

/** True when the stored value is already encrypted. */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptValue(value, env = process.env) {
  if (value === null || value === undefined || value === '') return value;
  if (isEncrypted(value)) return value;
  const key = encryptionKey(env);
  if (!key) return value;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptValue(value, env = process.env) {
  if (!isEncrypted(value)) return value;
  const key = encryptionKey(env);
  if (!key) return value;
  try {
    // The prefix is "enc:v1:" — two parts before the payload.
    const parts = String(value).split(':');
    const ivPart = parts[2];
    const tagPart = parts[3];
    const dataPart = parts[4];
    if (!ivPart || !tagPart || !dataPart) return value;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'), { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // A value that cannot be opened (wrong key) stays as it is: the owner must
    // see that something is wrong rather than get an empty field.
    return value;
  }
}

/** The row to store: the personal fields are encrypted. */
export function encryptCustomerRow(row = {}, env = process.env) {
  if (!row) return row;
  const out = { ...row };
  for (const field of PII_FIELDS) {
    if (out[field] !== undefined && out[field] !== null && out[field] !== '') {
      out[field] = encryptValue(out[field], env);
    }
  }
  return out;
}

/** The row to show: the personal fields are readable again. */
export function decryptCustomerRow(row = {}, env = process.env) {
  if (!row) return row;
  const out = { ...row };
  for (const field of PII_FIELDS) {
    if (typeof out[field] === 'string' && out[field]) {
      out[field] = decryptValue(out[field], env);
    }
  }
  return out;
}

/** The customer without any personal data left (a deletion request). */
export function blankCustomerRow(row = {}, env = process.env) {
  const out = { ...row };
  for (const field of PII_FIELDS) {
    if (out[field] !== undefined) out[field] = null;
  }
  out.displayName = '';
  return out;
}
