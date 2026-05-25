/** Date helpers */

export function toISODate(date: Date): string {
  return date.toISOString()
}

export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}
