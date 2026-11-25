import type { FieldType } from './store'

export interface FieldSuggestion {
  label: string
  type: FieldType
  value: string
  quote: string
}

// All suggestions carry the listing text that supports the proposed value.
export function fieldSuggestions(description: string): FieldSuggestion[] {
  const found = new Map<string, FieldSuggestion>()
  const add = (label: string, type: FieldType, value: string, quote: string) => {
    if (!found.has(label)) found.set(label, {label, type, value, quote})
  }
  for (const line of description.split(/\r?\n/)) {
    const quote = line.trim()
    const labeled = quote.match(/^(hours per week|weekly hours|type of work|employment type|wage\s*\/\s*salary|salary|compensation|location|time\s*zone|schedule|experience level|contract duration)\s*:\s*(.{1,120})$/i)
    if (labeled) {
      const key = labeled[1].toLowerCase()
      const value = labeled[2].trim()
      if (/^(n\/?a|unknown|not specified)$/i.test(value)) continue
      const label = /hours/.test(key) ? 'Weekly hours' : /salary|compensation/.test(key) ? 'Compensation'
        : /type/.test(key) ? 'Employment type' : key[0].toUpperCase() + key.slice(1)
      add(label, label === 'Weekly hours' && /^\d+(?:\.\d+)?$/.test(value) ? 'number' : 'text', value, quote)
    }
    const hours = quote.match(/\b(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s*(?:hours?|hrs?)\s*(?:per\s+|a\s+|each\s+|\/\s*)week\b/i)
    if (hours) add('Weekly hours', /^\d+(?:\.\d+)?$/.test(hours[1]) ? 'number' : 'text', hours[1], hours[0])
    const pay = quote.match(/(?:[$£€₱]\s*\d[\d,.]*(?:\s*[-–]\s*[$£€₱]?\s*\d[\d,.]*)?)\s*(?:\/\s*|per\s+|an?\s+)(?:hr|hour|week|month|year)\b/i)
    if (pay) add('Compensation', 'text', pay[0], pay[0])
  }
  return [...found.values()]
}
