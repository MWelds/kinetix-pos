import { randomBytes } from 'crypto'

/** Generates a URL-safe random ID (16 bytes = 22 chars base64url) */
export function generateId(): string {
  return randomBytes(16).toString('base64url')
}
