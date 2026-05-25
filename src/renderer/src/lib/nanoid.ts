/** Generates a short random ID for client-side use */
export function nanoid(): string {
  return Math.random().toString(36).slice(2, 11)
}
