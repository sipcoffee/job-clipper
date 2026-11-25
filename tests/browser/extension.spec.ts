import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { resolve } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const extension = resolve('.output/chrome-mv3')
async function launch(profile: string, channel: string) {
  return chromium.launchPersistentContext(profile, {
    channel,
    headless: true,
    args: [
      '--enable-unsafe-extension-debugging',
      '--disable-extensions-except=' + extension,
      '--load-extension=' + extension,
    ],
  })
}
async function install(context: BrowserContext) {
  const worker =
    context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  return { id: new URL(worker.url()).hostname }
}
async function capture(page: Page, id: string) {
  await page.bringToFront()
  const client = await page.context().newCDPSession(page)
  const { targetInfo } = await client.send('Target.getTargetInfo')
  const browserClient = await page.context().browser()!.newBrowserCDPSession()
  const { targetInfos } = await browserClient.send('Target.getTargets', {
    filter: [{ type: 'tab' }],
  })
  const target =
    targetInfos.find((t) => t.url === page.url()) ||
    targetInfos.find((t) => t.targetId === targetInfo.parentId)
  if (!target)
    throw new Error('Missing tab target: ' + JSON.stringify(targetInfos))
  await browserClient.send('Extensions.triggerAction', {
    id,
    targetId: target.targetId,
  })
}
test('toolbar capture, custom fields, duplicate detection and history after restart', async ({}, info) => {
  const profile = await mkdtemp(tmpdir() + '/jobclipper-test-')
  let context = await launch(profile, 'chromium')
  try {
    const { id } = await install(context)
    const page = context.pages()[0]
    const url = 'https://jobs.example.org/assistant'
    await page.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main><h1>Operations VA</h1><div class="job-description">Maintain the calendar.</div></main>',
      }),
    )
    await page.goto(url)
    await expect
      .poll(() =>
        context
          .serviceWorkers()[0]
          .evaluate(() => chrome.action.onClicked.hasListeners()),
      )
      .toBe(true)
    await capture(page, id)
    await expect
      .poll(() =>
        context
          .serviceWorkers()[0]
          .evaluate(
            async () =>
              Object.keys(await chrome.storage.session.get(null)).length,
          ),
      )
      .toBe(1)
    const panel = await context.newPage()
    await panel.goto('chrome-extension://' + id + '/sidepanel.html')
    await expect(panel.getByLabel('Job title')).toHaveValue('Operations VA')
    await panel.getByRole('button', { name: 'Settings' }).click()
    await panel.getByLabel('Field name').fill('My bid')
    await panel.getByLabel('Entry mode').selectOption('manual')
    await panel.getByRole('button', { name: 'Add field' }).click()
    await panel.getByRole('button', { name: 'Capture', exact: true }).click()
    await panel.getByLabel('My bid').fill('12 USD')
    await panel.getByLabel('Job title').fill('Reviewed VA')
    await panel.getByLabel('Date applied').fill('2026-10-01')
    await panel.getByRole('button', { name: 'Log application' }).click()
    await expect(
      panel.getByRole('button', { name: 'Reviewed VA' }),
    ).toBeVisible()
    await capture(page, id)
    await expect(
      panel.getByRole('button', { name: 'Open application logged 2026-10-01' }),
    ).toBeVisible()
    await context.close()
    context = await launch(profile, 'chromium')
    const restored = await context.newPage()
    await restored.setViewportSize({width: 360, height: 740})
    await restored.goto('chrome-extension://' + id + '/sidepanel.html')
    await restored.getByRole('button', { name: 'History' }).click()
    await restored.getByRole('button', { name: 'Reviewed VA' }).click()
    await expect(restored.getByLabel('My bid')).toHaveValue('12 USD')
    await expect(restored.getByLabel('Date applied')).toHaveValue('2026-10-01')
    await expect(
      restored.getByLabel('Job description', { exact: true }),
    ).toHaveValue('Maintain the calendar.')
    await restored.screenshot({ path: info.outputPath('review.png') })
  } finally {
    await context.close()
  }
})

test('selected text and manual saving after a failed model download', async () => {
  const context = await launch(
    await mkdtemp(tmpdir() + '/jobclipper-fallback-'),
    'chromium',
  )
  try {
    const { id } = await install(context)
    const listing = context.pages()[0]
    const panel = await context.newPage()
    await panel.goto('chrome-extension://' + id + '/sidepanel.html')
    const url = 'https://jobs.example.org/results'
    await listing.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main><h1>Jobs</h1><article>Other role</article><article id="selected">File invoices each Friday.</article></main>',
      }),
    )
    await listing.goto(url)
    await listing.locator('#selected').evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      window.getSelection()!.addRange(range)
    })
    await capture(listing, id)
    await expect(panel.getByLabel('Listing URL')).toHaveValue(url)
    await panel.getByRole('button', { name: 'Use selected text' }).click()
    await expect(
      panel.getByLabel('Job description', { exact: true }),
    ).toHaveValue('File invoices each Friday.')
    await context.route('https://huggingface.co/**', (route) =>
      route.abort('connectionreset'),
    )
    await panel.getByRole('button', { name: 'Settings' }).click()
    await panel
      .getByRole('button', { name: 'Download and enable model' })
      .click()
    await expect(panel.getByText(/Local model unavailable/)).toBeVisible({
      timeout: 20000,
    })
    await panel.getByRole('button', { name: 'Capture', exact: true }).click()
    await panel.getByLabel('Job title').fill('Invoice clerk')
    await panel.getByRole('button', { name: 'Log application' }).click()
    await expect(
      panel.getByRole('button', { name: 'Invoice clerk' }),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})

test('model suggestions arriving after review respect user edits',async()=>{
  const context=await launch(await mkdtemp(tmpdir()+'/jobclipper-edit-'),'chromium')
  try{
    const {id}=await install(context)
    const panel=await context.newPage()
    // Control only the timing and result of inference. The panel and database are real.
    await panel.addInitScript(()=>{
      class DelayedWorker {
        onmessage?: (e:{data:unknown})=>void
        postMessage(request:{requestId:string}){
          window.addEventListener('finish-inference',()=>this.onmessage?.({data:{
            status:'done', requestId:request.requestId, rows:[{id:'company',value:'Poster LLC',quote:'Poster LLC is hiring'}]
          }}),{once:true})
        }
        terminate(){}
      }
      Object.defineProperty(window,'Worker',{value:DelayedWorker})
    })
    await panel.goto('chrome-extension://'+id+'/sidepanel.html')
    await panel.getByLabel('Job description',{exact:true}).fill('Poster LLC is hiring')
    await panel.getByRole('button',{name:'Settings'}).click()
    await panel.getByRole('button',{name:'Download and enable model'}).click()
    await panel.getByRole('button',{name:'Capture',exact:true}).click()
    await panel.getByLabel('Company or client').fill('Reviewed client')
    await panel.evaluate(()=>window.dispatchEvent(new Event('finish-inference')))
    await expect(panel.getByText('Local model ready · 0 suggestions')).toBeVisible()
    await expect(panel.getByLabel('Company or client')).toHaveValue('Reviewed client')
  }finally{await context.close()}
})

test('adds a suggested field and refreshes listing facts without overwriting a correction', async()=>{
  const context=await launch(await mkdtemp(tmpdir()+'/jobclipper-refresh-'),'chromium')
  try {
    const {id}=await install(context)
    const listing=context.pages()[0]
    const panel=await context.newPage()
    await panel.goto('chrome-extension://'+id+'/sidepanel.html')
    await listing.route('https://jobs.example.org/va',route=>route.fulfill({contentType:'text/html',body:'<main><h1>Office assistant</h1><div class="job-description">Work 20 hours per week.</div></main>'}))
    await listing.goto('https://jobs.example.org/va')
    await capture(listing,id)
    await panel.getByRole('button',{name:'Add Weekly hours'}).click()
    await expect(panel.getByLabel('Weekly hours')).toHaveValue('20')
    await panel.getByLabel('Job title').fill('Reviewed title')
    await listing.locator('.job-description').evaluate(el=>{el.textContent='Work 30 hours per week.'})
    await panel.getByRole('button',{name:'Refresh listing'}).click()
    await expect(panel.getByText('Listing refreshed.')).toBeVisible()
    await expect(panel.getByLabel('Weekly hours')).toHaveValue('30')
    await expect(panel.getByLabel('Job title')).toHaveValue('Reviewed title')
  }finally{await context.close()}
})
