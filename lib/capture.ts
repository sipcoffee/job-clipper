export interface Capture {
  pageUrl: string
  url: string
  title: string
  company: string
  description: string
  selection: string
  ambiguous: boolean
  direct: boolean
}

// This function is injected by value. Keep all DOM helpers inside its body.
export function capturePage(): Capture {
  const pageUrl = location.href
  const url = new URL(pageUrl)
  const first = (root: ParentNode, selectors: string) =>
    root.querySelector<HTMLElement>(selectors)
  const plain = (element: HTMLElement | null) => {
    if (!element) return ''
    const copy = element.cloneNode(true) as HTMLElement
    copy
      .querySelectorAll('script,style,nav,aside,button,footer,[hidden]')
      .forEach((node) => node.remove())
    copy.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
    copy.querySelectorAll('li').forEach((node) => node.prepend('• '))
    copy
      .querySelectorAll('p,li,div,section,h1,h2,h3')
      .forEach((node) => node.append('\n'))
    return (copy.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const htmlText = (html: string) =>
    plain(new DOMParser().parseFromString(html, 'text/html').body)
  const details = first(
    document,
    '#jobsearch-ViewjobPaneWrapper, .jobsearch-ViewJobLayout, [data-testid="jobsearch-ViewjobPaneWrapper"], [data-test="job-details"]',
  )
  const activeKey = url.searchParams.get('vjk') || url.searchParams.get('jk')
  const indeed = /(^|\.)indeed\.com(\.|$)/i.test(url.hostname)
  const directIndeed = indeed && activeKey ? new URL('/viewjob', pageUrl) : null
  if (directIndeed && activeKey) directIndeed.searchParams.set('jk', activeKey)
  const jobs: Record<string, any>[] = []
  const visit = (value: any) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    if ([value['@type']].flat().includes('JobPosting')) jobs.push(value)
    if (value['@graph']) visit(value['@graph'])
  }
  for (const tag of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      visit(JSON.parse(tag.textContent || 'null'))
    } catch {
      /* Some pages have malformed metadata. */
    }
  }
  const selected = window.getSelection()?.toString().trim() || ''
  const draft = {
    pageUrl,
    url: pageUrl,
    title: '',
    company: '',
    description: '',
    selection: selected,
    ambiguous: false,
    direct: false,
  }
  const heading = document.querySelector('h1')?.textContent?.trim() || ''
  if (
    /^(request blocked|access denied|just a moment|verify (you are|you're) human|security verification|sign in|page not found)\b/i.test(
      heading + ' ' + document.title,
    ) ||
    document.querySelector('#challenge-running, #challenge-stage')
  )
    return { ...draft, ambiguous: true }
  const split = Boolean(
    url.searchParams.has('vjk') ||
      document.querySelector('[data-jk], [data-test="job-tile-list"]'),
  )
  const job =
    activeKey && indeed
      ? jobs.find(
          (item) =>
            String(item.identifier?.value) === activeKey ||
            (typeof item.url === 'string' &&
              new URL(item.url, pageUrl).searchParams.get('jk') === activeKey),
        )
      : !split && jobs.length === 1
        ? jobs[0]
        : undefined
  if (
    job &&
    typeof job.title === 'string' &&
    typeof job.description === 'string'
  ) {
    const link = new URL(
      typeof job.url === 'string' ? job.url : directIndeed?.href || pageUrl,
      pageUrl,
    )
    return {
      ...draft,
      url: /^https?:$/.test(link.protocol) ? link.href : pageUrl,
      direct: true,
      title: htmlText(job.title),
      company:
        typeof job.hiringOrganization?.name === 'string'
          ? job.hiringOrganization.name
          : '',
      description: htmlText(job.description),
    }
  }
  if ((split && !details) || (jobs.length > 1 && !details))
    return { ...draft, ambiguous: true }
  const root = details || document
  const description = first(
    root,
    '#jobDescriptionText, [data-test="Description"], [data-test="job-description"], #job-description, .job-description, [itemprop="description"]',
  )
  const title = first(
    root,
    '[data-testid="jobsearch-JobInfoHeader-title"], [data-test="job-title"], [itemprop="title"], h1, .jobsearch-JobInfoHeader-title',
  )
  const main = first(root, 'article, main, [role="main"]')
  if (split && directIndeed && details) {
    const paneKey =
      details.getAttribute('data-jk') ||
      details.querySelector('[data-jk]')?.getAttribute('data-jk')
    const card = [...document.querySelectorAll<HTMLElement>('[data-jk]')].find(
      (el) => el.dataset.jk === activeKey && !details.contains(el),
    )
    const heading = title?.textContent.trim().toLowerCase()
    const cardMatches =
      heading && card?.textContent.trim().toLowerCase().includes(heading)
    if (paneKey ? paneKey !== activeKey : !cardMatches)
      return { ...draft, ambiguous: true }
  }
  if (
    !title ||
    (!description &&
      (!main || document.querySelectorAll('article').length > 1)) ||
    (split && !directIndeed && !details?.querySelector('a[rel="bookmark"]'))
  )
    return { ...draft, ambiguous: true }
  const bookmark =
    details?.querySelector<HTMLAnchorElement>('a[rel="bookmark"]')
  const facts: string[] = []
  if (/(^|\.)onlinejobs\.ph$/i.test(url.hostname) && description) {
    for (const label of document.querySelectorAll('dd h3')) {
      const key = label.textContent.trim()
      const value = label.nextElementSibling?.textContent.trim()
      if (value && /^(type of work|wage \/ salary|hours per week)$/i.test(key))
        facts.push(key + ': ' + value)
    }
  }
  return {
    ...draft,
    direct: true,
    url: directIndeed?.href || bookmark?.href || pageUrl,
    title: plain(title),
    company: plain(
      first(
        root,
        '[data-testid="inlineHeader-companyName"], [itemprop="hiringOrganization"], [data-test="client-name"]',
      ),
    ),
    description: [...facts, plain(description || main)].join('\n\n'),
  }
}
