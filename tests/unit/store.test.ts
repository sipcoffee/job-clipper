import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db, empty, identity, save } from '../../lib/store'
import { suggestions } from '../../lib/model'
beforeEach(async () => {
  await db.applications.clear()
})
const record = () => ({
  ...empty(),
  title: 'VA',
  url: 'https://example.org/job/1',
  applied: '2026-11-01',
  description: '20 hours per week.',
  values: { hours: '20' },
})
it('atomically prevents duplicate direct listings and keeps edits', async () => {
  const [a, b] = await Promise.all([save(record(), true), save(record(), true)])
  expect([a.duplicate, b.duplicate].sort()).toEqual([false, true])
  await save({ ...a.record, title: 'Reviewed VA' }, true)
  db.close()
  await db.open()
  expect(await db.applications.toArray()).toMatchObject([
    { title: 'Reviewed VA', applied: '2026-11-01', values: { hours: '20' } },
  ])
})
it('allows two jobs sharing a results URL', async () => {
  await save(record(), false)
  await save(record(), false)
  expect(await db.applications.count()).toBe(2)
})
it('rejects missing titles, unsafe links and invalid dates', async () => {
  for (const patch of [
    { url: 'javascript:void(0)' },
    { title: ' ' },
    { applied: '2025-02-30' },
  ])
    await expect(save({ ...record(), ...patch }, true)).rejects.toThrow()
})
it('recognizes direct posting identities', () => {
  expect(identity('https://www.upwork.com/jobs/VA_~01234/')).toBe(
    'upwork:~01234',
  )
  expect(identity('https://www.onlinejobs.ph/jobseekers/job/Role-123')).toBe(
    'olj:123',
  )
  expect(identity('https://www.indeed.com/jobs?vjk=a')).toBe(
    identity('https://www.indeed.com/viewjob?jk=a'),
  )
})
it('checks evidence, type, and ownership before accepting values', () => {
  const field = {
    id: 'hours',
    label: 'Hours',
    type: 'number' as const,
    mode: 'extract' as const,
    hint: '',
  }
  const row = { id: 'hours', value: 20, quote: '20 hours' }
  const run = (rows: unknown[]) =>
    suggestions(rows, '20 hours per week', [
      field,
      { ...field, id: 'bid', mode: 'manual' },
    ])
  expect(run([row, { ...row, id: 'bid' }])).toEqual([{ ...row, value: '20' }])
  expect(
    run([
      { ...row, value: 2 },
      { ...row, quote: '40 hours' },
    ]),
  ).toEqual([])
})
