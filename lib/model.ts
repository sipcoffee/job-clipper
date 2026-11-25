import { z } from 'zod'
import type { Field } from './store'
export type Suggestion = { id: string; value: string; quote: string }
export function suggestions(
  output: unknown,
  source: string,
  fields: Field[],
): Suggestion[] {
  const rows = z.array(z.unknown()).safeParse(output)
  if (!rows.success) return []
  const result: Suggestion[] = []
  for (const row of rows.data) {
    const item = z
      .object({
        id: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        quote: z.string().trim().min(1),
      })
      .safeParse(row)
    if (!item.success) continue
    const { id, quote } = item.data
    const field = fields.find((f) => f.id === id && f.mode === 'extract')
    if (!field || !source.includes(quote)) continue
    const value = String(item.data.value).trim()
    if (!value || result.some((s) => s.id === id)) continue
    if (
      field.type === 'number' &&
      (!Number.isFinite(Number(value)) ||
        !quote.match(/-?\d+(?:\.\d+)?/g)?.includes(value))
    )
      continue
    if (field.type === 'date' && !z.iso.date().safeParse(value).success)
      continue
    if (field.type === 'yes/no' && !['yes', 'no'].includes(value.toLowerCase()))
      continue
    if (
      field.type === 'text' &&
      !quote.toLowerCase().includes(value.toLowerCase())
    )
      continue
    result.push({
      id,
      quote,
      value: field.type === 'yes/no' ? value.toLowerCase() : value,
    })
  }
  return result
}
export interface ModelRequest {
  source: string
  fields: Field[]
  requestId: string
}
