// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { capturePage } from '../../lib/capture'
function page(url: string, html: string) {
  vi.stubGlobal('location', new URL(url))
  document.body.innerHTML = html
}
it('uses a single structured posting and preserves bullet points', () => {
  const job = {
    '@type': 'JobPosting',
    title: 'Assistant',
    description: '<ul><li>Schedule calls</li><li>Manage inbox</li></ul>',
    hiringOrganization: { name: 'Example' },
  }
  page(
    'https://example.org/careers/1',
    '<script type="application/ld+json">' +
      JSON.stringify({ '@graph': [job] }) +
      '</script>',
  )
  expect(capturePage()).toMatchObject({
    title: 'Assistant',
    company: 'Example',
    description: '• Schedule calls\n• Manage inbox',
    direct: true,
  })
})
it('captures the active Indeed detail pane instead of a stale structured record', () => {
  const stale = JSON.stringify({
    '@type': 'JobPosting',
    identifier: { value: 'aaa' },
    title: 'Other',
    description: 'Stale',
  })
  page(
    'https://www.indeed.com/jobs?vjk=bbb',
    '<script type="application/ld+json">' +
      stale +
      '</script><a data-jk="aaa">Other job</a><div id="jobsearch-ViewjobPaneWrapper" data-jk="bbb"><h1>New job</h1><div id="jobDescriptionText">New duties</div></div>',
  )
  expect(capturePage()).toMatchObject({
    title: 'New job',
    description: 'New duties',
    url: 'https://www.indeed.com/viewjob?jk=bbb',
  })
})
it('requests a selection on a results page', () => {
  page(
    'https://example.org/jobs',
    '<main><h1>Jobs</h1><article>One</article><article>Two</article></main>',
  )
  expect(capturePage()).toMatchObject({ ambiguous: true, direct: false })
})

it('avoids pairing a newly selected Indeed URL with the previous job pane', () => {
  page(
    'https://www.indeed.com/jobs?vjk=new',
    '<div id="jobsearch-ViewjobPaneWrapper" data-jk="old"><h1>Old job</h1><div id="jobDescriptionText">Old duties</div></div>',
  )
  expect(capturePage()).toMatchObject({
    ambiguous: true,
    direct: false,
    title: '',
  })
})
it('handles Upwork detail markup and ignores the other listed jobs', () => {
  page(
    'https://www.upwork.com/jobs/~123',
    '<h1>Recommendations</h1><div data-test="job-details"><h1>Payroll assistant</h1><div data-test="Description">Review invoices.</div></div>',
  )
  expect(capturePage()).toMatchObject({
    title: 'Payroll assistant',
    description: 'Review invoices.',
  })
})
it('leaves access challenges available for manual capture', () => {
  page(
    'https://www.indeed.com/viewjob?jk=123',
    '<main><h1>Request Blocked</h1>Verify your browser.</main>',
  )
  expect(capturePage()).toMatchObject({
    ambiguous: true,
    title: '',
    description: '',
  })
})
