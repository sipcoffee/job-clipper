import { JSDOM } from 'jsdom'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { capturePage } from '../lib/capture.ts'

// The visible job-board labels are the reference answers. Use the production
// capture function independently to build the text seen by the model.
export async function liveSamples() {
  const cache = '.cache/live-samples.json'
  try {
    return JSON.parse(await readFile(cache, 'utf8'))
  } catch {
    /* First evaluation. */
  }
  const origin = 'https://www.onlinejobs.ph'
  const samples = []
  const seen = new Set()
  for (const keyword of [
    'virtual assistant',
    'administrative assistant',
    'bookkeeper',
  ]) {
    const search = await fetch(
      origin +
        '/jobseekers/jobsearch?jobkeyword=' +
        encodeURIComponent(keyword),
    )
    if (!search.ok) throw new Error('Search returned ' + search.status)
    const document = new JSDOM(await search.text(), { url: search.url }).window
      .document
    const urls = [
      ...document.querySelectorAll('a[href*="/jobseekers/job/"]'),
    ].map((a) => a.href)
    for (const url of new Set(urls)) {
      if (seen.has(url) || new URL(url).origin !== origin) continue
      seen.add(url)
      const response = await fetch(url)
      if (!response.ok) continue
      const dom = new JSDOM(await response.text(), {
        url: response.url,
        runScripts: 'outside-only',
      })
      try {
        const capture = dom.window.eval('(' + capturePage.toString() + ')()')
        const names = ['HOURS PER WEEK', 'TYPE OF WORK', 'WAGE / SALARY']
        const index = samples.length % 3
        const label = names[index]
        const heading = [...dom.window.document.querySelectorAll('dd h3')].find(
          (el) => el.textContent.trim() === label,
        )
        const expected = heading?.nextElementSibling?.textContent.trim()
        if (
          !capture.direct ||
          !expected ||
          (index === 0 && !/^\d+(\.\d+)?$/.test(expected))
        )
          continue
        samples.push([
          capture.description,
          expected,
          [label.toLowerCase(), index === 0 ? 'number' : 'text'],
          url,
        ])
      } finally {
        dom.window.close()
      }
      if (samples.length === 30) {
        await mkdir('.cache', { recursive: true })
        await writeFile(cache, JSON.stringify(samples))
        return samples
      }
    }
  }
  throw new Error('Found only ' + samples.length + ' labeled listings')
}
