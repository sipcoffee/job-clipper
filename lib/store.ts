import Dexie, { type Table } from 'dexie'
import { z } from 'zod'

export type FieldType = 'text' | 'number' | 'date' | 'yes/no'
export interface Field {
  id: string
  label: string
  type: FieldType
  mode: 'extract' | 'manual'
  hint: string
}
export interface Application {
  id: string
  title: string
  company: string
  description: string
  url: string
  pageUrl: string
  applied: string
  values: Record<string, string>
  evidence: Record<string, string>
  created: number
  updated: number
  identity?: string
}
export function today(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
export function identity(raw: string) {
  const url = new URL(raw)
  url.hash = ''
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^from$|^ref$/i.test(key)) url.searchParams.delete(key)
  if (/(^|\.)indeed\.com(\.|$)/.test(url.hostname)) {
    const key = url.searchParams.get('vjk') || url.searchParams.get('jk')
    if (key) return 'indeed:' + key
  }
  if (/(^|\.)upwork\.com$/.test(url.hostname)) {
    const key = url.pathname.match(/~[\da-z]+/i)
    if (key) return 'upwork:' + key[0]
  }
  if (/(^|\.)onlinejobs\.ph$/.test(url.hostname)) {
    const key = url.pathname.match(/(?:-|\/)(\d+)\/?$/)
    if (key) return 'olj:' + key[1]
  }
  url.searchParams.sort()
  return url.href
}
export function empty(): Application {
  return {
    id: crypto.randomUUID(),
    title: '',
    company: '',
    description: '',
    url: '',
    pageUrl: '',
    applied: today(),
    values: {},
    evidence: {},
    created: Date.now(),
    updated: Date.now(),
  }
}
class JobDatabase extends Dexie {
  applications!: Table<Application, string>
  fields!: Table<Field, string>
  constructor() {
    super('jobclipper')
    this.version(1).stores({
      applications: 'id, &identity, updated',
      fields: 'id',
    })
  }
}
export const db = new JobDatabase()
export async function save(application: Application, direct: boolean) {
  z.string().trim().min(1, 'Enter a job title').parse(application.title)
  z.url({ protocol: /^https?$/ }).parse(application.url)
  z.iso.date().parse(application.applied)
  const record = {
    ...application,
    title: application.title.trim(),
    updated: Date.now(),
    identity: direct ? identity(application.url) : undefined,
  }
  return db.transaction('rw', db.applications, async () => {
    const existing =
      record.identity &&
      (await db.applications.where('identity').equals(record.identity).first())
    if (existing && existing.id !== record.id)
      return { duplicate: true, record: existing }
    await db.applications.put(record)
    return { duplicate: false, record }
  })
}
