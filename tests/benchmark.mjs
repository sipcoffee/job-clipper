// Run after building and installing Playwright Chromium. This opts into the model download.
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { execFileSync } from 'node:child_process'
import { liveSamples } from './live-samples.mjs'
const live = process.argv.includes('--live')
const dir = resolve('.output/chrome-mv3')
const resultsDir = resolve('.cache/benchmark')
await mkdir(resultsDir, { recursive: true })
const browser = await chromium.launchPersistentContext(
  resolve('.cache/model-pilot'),
  {
    channel: 'chromium',
    headless: true,
    args: ['--disable-extensions-except=' + dir, '--load-extension=' + dir],
  },
)
try {
  const sw =
    browser.serviceWorkers()[0] || (await browser.waitForEvent('serviceworker'))
  const page = await browser.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(msg.text())
  })
  await page.goto(new URL('sidepanel.html', sw.url()).href)
  const worker = (await readdir(dir + '/assets')).find((x) =>
    x.startsWith('inference.worker'),
  )
  const samples = live
    ? await liveSamples()
    : [
        ['A VA is needed for inbox triage. Work 20 hours per week.', 20],
        ['Scheduling assistant. Weekly commitment: 15 hours.', 15],
        ['Bookkeeper needed for 10 hours each week. Rate is $18 an hour.', 10],
        ['We guarantee 30 hours per week. Support two managers.', 30],
        ['Remote researcher. The role requires 12 hours/week.', 12],
        ['Our weekly schedule is 25 hours over five mornings.', 25],
        ['Full-time appointment setter, 40 hours a week.', 40],
        ['Calendar coordinator. We need 8 hrs/week of coverage.', 8],
        ['Data cleanup project. Budget covers 50 hours in total.', null],
        ['Administrative support, hours flexible. Budget is $200.', null],
        [
          'The tools team works in Airtable. You will maintain our records.',
          'Airtable',
        ],
        ['Update sales leads using HubSpot.', 'HubSpot'],
        ['Record decisions and meeting minutes in Notion.', 'Notion'],
        ['Use Asana to assign tasks and track escalations.', 'Asana'],
        ['All invoices are processed in QuickBooks.', 'QuickBooks'],
        ['Support staff must use Zendesk for all tickets.', 'Zendesk'],
        ['Track production deadlines in ClickUp.', 'ClickUp'],
        ['Manage our sales pipeline in Salesforce.', 'Salesforce'],
        ['Maintain our internal records. Software training provided.', null],
        [
          'We use a proprietary tool. Its name will be shared after hiring.',
          null,
        ],
        [
          'Applications close on 2027-01-15. Interviews are held later.',
          '2027-01-15',
        ],
        ['Submit your portfolio by 2027-02-03.', '2027-02-03'],
        ['Application deadline: 2026-12-22.', '2026-12-22'],
        ['Last date to apply is 2027-03-01.', '2027-03-01'],
        ['We accept resumes until 2027-01-09.', '2027-01-09'],
        ['Applicants must respond by 2027-03-31.', '2027-03-31'],
        ['Listing expires and applications close 2027-04-12.', '2027-04-12'],
        [
          'Start date is 2027-05-01. We accept applications on a rolling basis.',
          null,
        ],
        [
          'Published 2026-12-01. Applications are reviewed when received.',
          null,
        ],
        [
          'Immediate opening for a reliable assistant. Please apply soon.',
          null,
        ],
      ]
  await page.evaluate((path) => {
    window.modelWorker = new Worker(path, { type: 'module' })
  }, 'assets/' + worker)
  const run = async (source, fields) =>
    page.evaluate(
      ({ source, fields }) =>
        new Promise((resolve, reject) => {
          const worker = window.modelWorker
          const timeout = setTimeout(
            () => reject(new Error('Model request timed out')),
            180000,
          )
          worker.onerror = (e) => {
            clearTimeout(timeout)
            reject(new Error(e.message))
          }
          worker.onmessage = ({ data }) => {
            if (data.status === 'progress') return
            clearTimeout(timeout)
            data.status === 'error'
              ? reject(new Error(data.message))
              : resolve(data.rows)
          }
          worker.postMessage({ source, fields, requestId: crypto.randomUUID() })
        }),
      { source, fields },
    )
  const cold = performance.now()
  const client = await browser.browser().newBrowserCDPSession()
  let peakWorkingSetMiB = 0
  async function sampleMemory() {
    if (process.platform !== 'win32') return
    const { processInfo } = await client.send('SystemInfo.getProcessInfo')
    const ids = new Set(processInfo.map((p) => p.id))
    const lines = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    }).split(/\r?\n/)
    let kib = 0
    for (const line of lines) {
      const cols = line.slice(1, -1).split('","')
      if (ids.has(Number(cols[1])))
        kib += Number((cols[4] || '').replace(/\D/g, '')) || 0
    }
    peakWorkingSetMiB = Math.max(peakWorkingSetMiB, Math.round(kib / 1024))
  }
  await run('', [])
  const loadMs = Math.round(performance.now() - cold)
  await browser.setOffline(true)
  // Start a fresh worker offline: the runtime must reload model assets from cache.
  await page.evaluate((path) => {
    window.modelWorker.terminate()
    window.modelWorker = new Worker(path, { type: 'module' })
  }, 'assets/' + worker)
  await run('', [])
  const results = []
  for (const [i, [source, expected, liveField, url]] of samples.entries()) {
    const field =
      liveField ||
      (i < 10
        ? ['Weekly hours', 'number']
        : i < 20
          ? ['Named software tool', 'text']
          : ['Application deadline', 'date'])
    const started = performance.now()
    const rows = await run(source, [
      {
        id: 'field',
        label: field[0],
        type: field[1],
        mode: 'extract',
        hint: '',
      },
    ])
    results.push({
      ...(live ? { url, field: field[0] } : { source }),
      expected,
      value: rows[0]?.value ?? null,
      ms: Math.round(performance.now() - started),
    })
    if (i % 5 === 0) await sampleMemory()
  }
  const correct = results.filter(
    (r) => r.value !== null && r.value === String(r.expected),
  ).length
  const populated = results.filter((r) => r.value !== null).length
  const available = results.filter((r) => r.expected !== null).length
  const summary = {
    hostRamGiB: totalmem() / 2 ** 30,
    peakSampledBrowserWorkingSetMiB: peakWorkingSetMiB,
    loadMs,
    medianWarmMs: results.map((r) => r.ms).sort((a, b) => a - b)[15],
    correct,
    populated,
    available,
    precision: populated ? correct / populated : null,
    recall: correct / available,
  }
  console.log(summary)
  await writeFile(
    resultsDir + (live ? '/live-results.json' : '/examples-results.json'),
    JSON.stringify({ summary, results }, null, 2),
  )
} finally {
  await browser.close()
}
