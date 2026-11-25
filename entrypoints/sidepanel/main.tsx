import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  db,
  empty,
  identity,
  save,
  type Application,
  type Field,
  type FieldType,
} from '../../lib/store'
import { capturePage, type Capture } from '../../lib/capture'
import { fieldSuggestions, type FieldSuggestion } from '../../lib/field-suggestions'
import type { Suggestion } from '../../lib/model'
import Engine from '../../lib/inference.worker?worker'
import './style.css'

type View = 'Capture' | 'History' | 'Settings'
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
function App() {
  const [view, show] = useState<View>('Capture')
  const [draft, set] = useState<Application>(empty)
  const [direct, setDirect] = useState(false)
  const [selection, select] = useState('')
  const [sourceTab, tab] = useState<number>()
  const [fallback, manual] = useState(true)
  const [fields, definitions] = useState<Field[]>([])
  const [records, history] = useState<Application[]>([])
  const [query, search] = useState('')
  const [notice, tell] = useState('')
  const [duplicate, existing] = useState<Application>()
  const [enabled, enable] = useState(false)
  const [status, report] = useState('')
  const [busy, working] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const currentDraft = useRef(draft)
  currentDraft.current = draft
  const capturedUrl = useRef('')
  const [editingField, setEditingField] = useState<string>()
  const running = useRef(false)
  const [label, name] = useState(''),
    [kind, type] = useState<FieldType>('text'),
    [mode, entryMode] = useState<Field['mode']>('extract'),
    [hint, instruct] = useState('')
  const worker = useRef<Worker | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = useRef(new Set<string>()),
    request = useRef(''),
    captureToken = useRef(''),
    consent = useRef(false)
  function stop(keepIdleWorker = false) {
    request.current = ''
    clearTimeout(timer.current)
    if (keepIdleWorker && worker.current && !running.current) {
      timer.current = setTimeout(() => {
        worker.current?.terminate()
        worker.current = null
      }, 120000)
    } else {
      worker.current?.terminate()
      worker.current = null
    }
    running.current = false
    working(false)
    report('')
  }
  function infer(record: Application, all: Field[], force = false) {
    if (!consent.current || (!record.description && !force)) return
    const targets: Field[] = all.filter(
      (f) =>
        f.mode === 'extract' &&
        !record.values[f.id] &&
        !dirty.current.has(f.id),
    )
    for (const key of ['title', 'company'] as const)
      if (!record[key] && !dirty.current.has(key))
        targets.push({
          id: key,
          label: key === 'title' ? 'Job title' : 'Hiring company or client',
          type: 'text',
          mode: 'extract',
          hint: '',
        })
    if (!targets.length && !force) return
    clearTimeout(timer.current)
    const token = crypto.randomUUID()
    request.current = token
    const engine = (worker.current ??= new Engine())
    running.current = true
    working(true)
    report('Preparing local model…')
    engine.onerror = () => {
      stop()
      report('Local model unavailable. You can still edit and save.')
    }
    engine.onmessage = ({ data }) => {
      if (request.current !== token) return
      if (data.status === 'progress') {
        report(data.message)
        return
      }
      if (data.requestId !== token) return
      running.current = false
      working(false)
      timer.current = setTimeout(() => {
        engine.terminate()
        worker.current = null
      }, 120000)
      if (data.status === 'error') {
        report(
          'Local model unavailable. Check the download connection and retry.',
        )
        return
      }
      const rows = data.rows as Suggestion[]
      const untouched = rows.filter((r) => !dirty.current.has(r.id))
      set((current) => {
        if (
          current.id !== record.id ||
          current.description !== record.description
        )
          return current
        const next = {
          ...current,
          values: { ...current.values },
          evidence: { ...current.evidence },
        }
        for (const row of untouched) {
          if (row.id === 'title' || row.id === 'company')
            next[row.id] = row.value
          else next.values[row.id] = row.value
          next.evidence[row.id] = row.quote
        }
        return next
      })
      report('Local model ready · ' + untouched.length + ' suggestions')
    }
    engine.postMessage({
      requestId: token,
      source: record.description,
      fields: record.description ? targets : [],
    })
  }
  useEffect(() => {
    let alive = true,
      key = ''
    const read = async (payload: any) => {
      if (!payload || payload.pending || payload.token === captureToken.current)
        return
      captureToken.current = payload.token
      const c = payload.result as Capture | undefined
      capturedUrl.current = c?.direct ? c.url : ''
      const r = {
        ...empty(),
        pageUrl: c?.pageUrl || payload.url,
        url: c?.url || payload.url,
        title: c?.title || '',
        company: c?.company || '',
        description: c?.description || '',
      }
      stop(true)
      dirty.current.clear()
      set(r)
      setDirect(!!c?.direct)
      select(c?.selection || '')
      tab(payload.tabId)
      manual(!c || c.ambiguous)
      existing(undefined)
      show('Capture')
      tell(
        c?.ambiguous
          ? 'Select the job text on the page, or paste it below.'
          : !c
            ? 'Paste the listing text to finish this capture.'
            : '',
      )
      if (c?.direct) {
        const match = await db.applications
          .where('identity')
          .equals(identity(r.url))
          .first()
        if (alive && captureToken.current === payload.token) existing(match)
      }
      const defs = await db.fields.toArray()
      if (alive && captureToken.current === payload.token) infer(r, defs)
    }
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'session' && changes[key]) void read(changes[key].newValue)
    }
    const init = async () => {
      const [win, defs, prefs] = await Promise.all([
        chrome.windows.getCurrent(),
        db.fields.toArray(),
        chrome.storage.local.get('model'),
      ])
      if (!alive) return
      definitions(defs)
      consent.current = !!prefs.model
      enable(consent.current)
      key = 'capture:' + win.id
      chrome.storage.onChanged.addListener(listener)
      await read((await chrome.storage.session.get(key))[key])
    }
    void init().catch(() =>
      tell('Unable to open capture. Try the toolbar icon again.'),
    )
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(listener)
      clearTimeout(timer.current)
      worker.current?.terminate()
    }
  }, [])
  function change(
    key: 'title' | 'company' | 'description' | 'url' | 'applied',
    value: string,
  ) {
    dirty.current.add(key)
    if (key === 'url') {
      setDirect(true)
      existing(undefined)
    }
    set((r) => ({ ...r, [key]: value, evidence: { ...r.evidence, [key]: '' } }))
  }
  async function openHistory() {
    history(await db.applications.orderBy('updated').reverse().toArray())
    show('History')
  }
  function edit(r: Application) {
    capturedUrl.current = r.identity ? r.url : ''
    stop()
    captureToken.current = 'edited:' + r.id
    dirty.current.clear()
    set(r)
    setDirect(!!r.identity)
    existing(undefined)
    manual(false)
    tab(undefined)
    select('')
    show('Capture')
    tell('Editing saved application.')
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const result = await save(draft, direct)
      if (result.duplicate) {
        existing(result.record)
        tell('Already logged on ' + result.record.applied)
        return
      }
      stop(true)
      await openHistory()
      tell('Application saved.')
    } catch {
      tell('Check the title, web address, and application date.')
    }
  }
  async function refreshListing() {
    const previousToken = captureToken.current
    setRefreshing(true)
    try {
      const [active] = await chrome.tabs.query({active:true, currentWindow:true})
      const target = active?.url?.startsWith(chrome.runtime.getURL('')) ? sourceTab : active?.id
      if (target === undefined) throw new Error('Missing tab')
      const [injection] = await chrome.scripting.executeScript({target:{tabId:target}, func:capturePage})
      const listing = injection?.result
      if (captureToken.current !== previousToken) return
      if (!listing?.direct) {
        tell('Could not identify one job. Open its detail page and refresh, or paste its description into a draft.')
        return
      }
      const same = capturedUrl.current && identity(capturedUrl.current) === identity(listing.url)
      if (!same && dirty.current.size && !window.confirm('Replace your edited draft with the listing in the active tab?')) return
      const next = same ? {...currentDraft.current, values:{...currentDraft.current.values}, evidence:{...currentDraft.current.evidence}} : empty()
      if (!same) dirty.current.clear()
      stop(true)
      for (const key of ['url','description','title','company'] as const) {
        if (!dirty.current.has(key)) next[key] = listing[key]
      }
      for (const key of Object.keys(next.evidence)) {
        if (next.evidence[key] && !dirty.current.has(key)) {
          delete next.values[key]
          delete next.evidence[key]
        }
      }
      next.pageUrl = listing.pageUrl
      for (const item of fieldSuggestions(next.description)) {
        const field = fields.find(f => f.label.toLowerCase() === item.label.toLowerCase() && f.mode === 'extract' && (f.type === item.type || f.type === 'text'))
        if (field && !dirty.current.has(field.id) && !next.values[field.id]) {
          next.values[field.id] = item.value
          next.evidence[field.id] = item.quote
        }
      }
      const token = crypto.randomUUID()
      captureToken.current = token
      capturedUrl.current = listing.url
      set(next); setDirect(true); tab(target); select(listing.selection); manual(false); existing(undefined)
      tell('Listing refreshed.')
      infer(next, fields)
      await chrome.storage.session.set({['capture:'+active.windowId]:{token,tabId:target,url:listing.url,result:listing,pending:false}})
      const match = await db.applications.where('identity').equals(identity(next.url)).first()
      if (captureToken.current === token && match?.id !== next.id) existing(match)
    } catch {
      tell('To allow access on this tab, click the Jobclipper toolbar icon while viewing the listing.')
    } finally {
      setRefreshing(false)
    }
  }
  async function acceptSuggestion(item: FieldSuggestion) {
    const draftId = draft.id
    const field = await db.transaction('rw', db.fields, async () => {
      const found = (await db.fields.toArray()).find(f => f.label.toLowerCase() === item.label.toLowerCase())
      if (found) return found
      const created: Field = {id:crypto.randomUUID(), label:item.label, type:item.type, mode:'extract', hint:''}
      await db.fields.add(created)
      return created
    })
    definitions(await db.fields.toArray())
    if (currentDraft.current.id !== draftId || currentDraft.current.values[field.id] || field.mode !== 'extract') return
    stop(true)
    set(record => ({...record, values:{...record.values,[field.id]:item.value}, evidence:{...record.evidence,[field.id]:item.quote}}))
  }
  async function selected() {
    let text = selection
    if (sourceTab !== undefined)
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: sourceTab },
          func: () => ({
            url: location.href,
            text: window.getSelection()?.toString(),
          }),
        })
        if (res[0]?.result?.url === draft.pageUrl)
          text = res[0].result.text || text
      } catch {
        /* Keep the selection captured at toolbar click. */
      }
    if (!text) {
      tell(
        'Highlight the job description on the page first, or paste it below.',
      )
      return
    }
    change('description', text)
    manual(true)
    tell('Selected text captured. Review the job title and link.')
    infer({ ...draft, description: text }, fields)
  }
  async function addField(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    const field = {
      id: editingField || crypto.randomUUID(),
      label: label.trim(),
      type: kind,
      mode,
      hint: hint.trim(),
    }
    await db.fields.put(field)
    definitions(await db.fields.toArray())
    setEditingField(undefined)
    name('')
    instruct('')
  }
  const input = (
    key: 'title' | 'company' | 'url' | 'applied',
    caption: string,
    inputType = 'text',
  ) => (
    <label>
      {caption}
      <input
        type={inputType}
        value={draft[key]}
        required={key !== 'company'}
        onChange={(e) => change(key, e.target.value)}
      />
      {draft.evidence[key] && <small>{draft.evidence[key]}</small>}
    </label>
  )
  const saved = Boolean(draft.identity || records.some((record) => record.id === draft.id))
  const recommendations = fieldSuggestions(draft.description).filter(item => {
    const field = fields.find(f => f.label.toLowerCase() === item.label.toLowerCase())
    return !field || (field.mode === 'extract' && (field.type === item.type || field.type === 'text') && !draft.values[field.id] && !dirty.current.has(field.id))
  })
  const matches = records.filter((record) =>
    [record.title, record.company, host(record.url)].join(' ').toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <>
      <header>
        <span className="mark" aria-hidden="true"><i /></span>
        <strong>Jobclipper</strong>
      </header>
      <nav aria-label="Workspace">
        {(['Capture', 'History', 'Settings'] as View[]).map((v) => (
          <button
            key={v}
            aria-current={view === v ? 'page' : undefined}
            onClick={() => (v === 'History' ? void openHistory() : show(v))}
          >
            {v}
          </button>
        ))}
      </nav>
      <main>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {view === 'Capture' && (
          <>
            <div className="page-title"><h1>{saved ? 'Edit application' : 'Application draft'}</h1></div>
            {duplicate && (
              <button className="notice" onClick={() => edit(duplicate)}>
                Open application logged {duplicate.applied}
              </button>
            )}
            <form id="application" onSubmit={submit}>
              <section className="card source-card">
                <button type="button" disabled={refreshing} onClick={refreshListing}>{refreshing ? 'Refreshing…' : 'Refresh listing'}</button>
                {input('url', 'Listing URL', 'url')}
                <p className="hint">{saved ? 'Saved link to the original posting.' : sourceTab !== undefined && !fallback
                  ? 'Captured from ' + host(draft.pageUrl) + '.'
                  : 'To autofill, open the listing and click Jobclipper in the browser toolbar. Pasting a link here sets the saved address.'}</p>
              </section>
              <section className="card">
              {input('title', 'Job title')}
              <div className="pair">
              {input('company', 'Company or client')}
              {input('applied', 'Date applied', 'date')}
              </div>
              </section>
              {draft.description.trim() && <section className="card">
                <h2>Suggested fields</h2>
                {!recommendations.length && <p className="hint">No additional fields found. You can define a field in Settings.</p>}
                {recommendations.map(item => <div className="field-suggestion" key={item.label}>
                  <div><strong>{item.label}</strong><p>{item.value}</p><small>{item.quote !== item.value ? item.quote : ''}</small></div>
                  <button type="button" aria-label={'Add '+item.label} onClick={()=>void acceptSuggestion(item)}>Add</button>
                </div>)}
              </section>}
              {fields.length > 0 && <section className="card"><h2>Custom fields</h2>
              {fields.map((f) => (
                <label key={f.id}>
                  {f.label}
                  {f.type === 'yes/no' ? (
                    <select
                      value={draft.values[f.id] || ''}
                      onChange={(e) => custom(f.id, e.target.value)}
                    >
                      <option value="">Unknown</option>
                      <option>yes</option>
                      <option>no</option>
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      step={f.type === 'number' ? 'any' : undefined}
                      value={draft.values[f.id] || ''}
                      onChange={(e) => custom(f.id, e.target.value)}
                    />
                  )}
                  {draft.evidence[f.id] && (
                    <small>“{draft.evidence[f.id]}”</small>
                  )}
                </label>
              ))}
              </section>}
              <details className="card" open={fallback || undefined}>
                <summary>Job description</summary>
                <textarea
                  aria-label="Job description"
                  placeholder="Paste job text"
                  rows={5}
                  value={draft.description}
                  onChange={(e) => change('description', e.target.value)}
                />
              </details>
              <div className="actions">
                {sourceTab !== undefined && (
                  <button type="button" onClick={selected}>
                    Use selected text
                  </button>
                )}
                {enabled && (
                  <button
                    type="button"
                    disabled={busy || !draft.description}
                    onClick={() => infer(draft, fields, true)}
                  >
                    Extract fields
                  </button>
                )}
              </div>
            </form>
          </>
        )}
        {view === 'History' && (
          <>
            <div className="page-title"><h1>Application history</h1><span className="count" aria-label={records.length+' applications'}>{records.length}</span></div>
            <input
              type="search"
              aria-label="Search applications"
              placeholder="Search title, company, or site"
              value={query}
              onChange={(e) => search(e.target.value)}
            />
            {matches
              .map((r) => (
                <article key={r.id}>
                  <button className="record" onClick={() => edit(r)}>
                    {r.title}
                  </button>
                  <p>{[r.company, host(r.url)].filter(Boolean).join(' · ')}</p>
                  <footer>
                    {r.applied}
                    <a href={r.url} target="_blank" rel="noreferrer">
                      Open listing ↗
                    </a>
                  </footer>
                </article>
              ))}
            {!records.length && <div className="empty"><h2>No applications yet</h2><p>Capture a listing and choose Log application to save it here.</p></div>}
            {records.length > 0 && !matches.length && <div className="empty"><h2>No matches</h2><button onClick={()=>search('')}>Clear search</button></div>}
          </>
        )}
        {view === 'Settings' && (
          <>
            <h1>Settings</h1>
            <section className="card">
            <h2>Local extraction</h2>
            <p>
              SmolLM2 runs on this device. The first download uses about 363 MB
              plus tokenizer files.
            </p>
            <button
              onClick={async () => {
                const next = !enabled
                await chrome.storage.local.set({ model: next })
                consent.current = next
                enable(next)
                if (next) infer(draft, fields, true)
                else stop()
              }}
            >
              {enabled ? 'Disable local model' : 'Download and enable model'}
            </button>
            </section>
            <section className="card">
            <h2>Custom fields</h2>
            {fields.map((f) => (
              <p key={f.id}>
                {f.label}{' '}
                <small>
                  {f.type} · {f.mode === 'manual' ? 'Manual' : 'From listing'}
                </small>{' '}
                <button
                  onClick={() => {
                    setEditingField(f.id)
                    name(f.label)
                    type(f.type)
                    entryMode(f.mode)
                    instruct(f.hint)
                  }}
                >
                  Edit field
                </button>
              </p>
            ))}
            <form onSubmit={addField}>
              <label>
                Field name
                <input
                  required
                  value={label}
                  onChange={(e) => name(e.target.value)}
                />
              </label>
              <label>
                Type
                <select
                  disabled={!!editingField}
                  value={kind}
                  onChange={(e) => type(e.target.value as FieldType)}
                >
                  {['text', 'number', 'date', 'yes/no'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Entry mode
                <select
                  value={mode}
                  onChange={(e) => entryMode(e.target.value as Field['mode'])}
                >
                  <option value="extract">Extract from listing</option>
                  <option value="manual">Fill in myself</option>
                </select>
              </label>
              {mode === 'extract' && (
                <label>
                  Extraction hint (optional)
                  <input
                    value={hint}
                    onChange={(e) => instruct(e.target.value)}
                  />
                </label>
              )}
              <button type="submit">
                {editingField ? 'Update field' : 'Add field'}
              </button>
            </form>
            </section>
          </>
        )}
        {status && (
          <p role="status" className="source">
            {status}
          </p>
        )}
      </main>
      {view === 'Capture' && <div className="save-bar"><button className="primary" form="application" type="submit">{saved ? 'Save application' : 'Log application'}<span aria-hidden="true">↵</span></button></div>}
    </>
  )
  function custom(id: string, value: string) {
    dirty.current.add(id)
    set((r) => ({
      ...r,
      values: { ...r.values, [id]: value },
      evidence: { ...r.evidence, [id]: '' },
    }))
  }
}
createRoot(document.getElementById('root')!).render(<App />)
