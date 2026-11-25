// Public pilot checks. Job boards can change or require a signed-in browser.
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
const dir = resolve('.output/chrome-mv3')
const urls = process.argv.slice(2)
if (!urls.length)
  throw new Error('Pass the public URL of an individual listing.')
for (const channel of ['chrome', 'msedge']) {
  const context = await chromium.launchPersistentContext(
    await mkdtemp(tmpdir() + '/jobclipper-live-'),
    {
      channel,
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--load-extension=' + dir],
    },
  )
  try {
    const client = await context.browser().newBrowserCDPSession()
    const installed = await client.send('Extensions.getExtensions')
    const { id } =
      installed.extensions.find((e) => e.name === 'Jobclipper') ||
      (await client.send('Extensions.loadUnpacked', { path: dir }))
    if (!context.serviceWorkers().some((w) => w.url().includes(id)))
      await context.waitForEvent('serviceworker', {
        predicate: (w) => w.url().includes(id),
        timeout: 10000,
      })
    const page = context.pages()[0]
    const panel = await context.newPage()
    await panel.goto('chrome-extension://' + id + '/sidepanel.html')
    for (const url of urls) {
      try {
        await page.bringToFront()
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })
        await page
          .locator('h1')
          .first()
          .waitFor({ timeout: 5000 })
          .catch(() => {})
        const { targetInfos } = await client.send('Target.getTargets', {
          filter: [{ type: 'tab' }],
        })
        const target = targetInfos.find((t) => t.url === page.url())
        const started = performance.now()
        await client.send('Extensions.triggerAction', {
          id,
          targetId: target.targetId,
        })
        await panel.waitForFunction(
          (u) =>
            document.querySelector('input[type=url]')?.value === u ||
            document.querySelector('.source')?.textContent ===
              new URL(u).hostname.replace(/^www\./, ''),
          page.url(),
          { timeout: 5000 },
        )
        const title = await panel.getByLabel('Job title').inputValue()
        const chars = (
          await panel
            .getByLabel('Job description', { exact: true })
            .inputValue()
        ).length
        console.log(
          JSON.stringify({
            channel,
            site: new URL(url).hostname,
            http: response.status(),
            title,
            chars,
            ms: Math.round(performance.now() - started),
          }),
        )
        if (response.status() >= 400 || !title || !chars) process.exitCode = 1
      } catch (e) {
        console.error(channel, new URL(url).hostname, String(e))
        process.exitCode = 1
      }
    }
  } catch (e) {
    console.error(channel, String(e))
    process.exitCode = 1
  } finally {
    await context.close()
  }
}
