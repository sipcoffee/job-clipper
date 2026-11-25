import { env, pipeline } from '@huggingface/transformers'
import { suggestions, type ModelRequest } from './model'
env.allowLocalModels = false
const wasm = env.backends.onnx.wasm!
wasm.wasmPaths = new URL('/runtime/', self.location.href).href
wasm.numThreads = 1
wasm.proxy = false
const load = () =>
  pipeline('text-generation', 'onnx-community/SmolLM2-360M-Instruct-ONNX', {
    device: 'wasm',
    dtype: 'int8',
    revision: 'fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9',
    progress_callback: (event) => {
      if (event.status === 'progress')
        self.postMessage({
          status: 'progress',
          message:
            'Loading ' + event.file + ' · ' + Math.round(event.progress) + '%',
        })
    },
  })
let engine: ReturnType<typeof load> | undefined
self.onmessage = async ({ data }: { data: ModelRequest }) => {
  try {
    const run = await (engine ??= load())
    const found = []
    for (const field of data.fields) {
      // Many job boards render facts as labeled rows. Prefer an unambiguous
      // exact label and retain its original line as evidence.
      const labeled = data.source.split(/\r?\n/).filter((line) => {
        const colon = line.indexOf(':')
        return (
          colon > 0 &&
          line.slice(0, colon).trim().toLowerCase() ===
            field.label.trim().toLowerCase()
        )
      })
      if (!field.hint && labeled.length === 1) {
        const quote = labeled[0]
        const value = quote.slice(quote.indexOf(':') + 1).trim()
        const verified = suggestions(
          [{ id: field.id, value, quote }],
          data.source,
          [field],
        )
        if (verified.length) {
          found.push(...verified)
          continue
        }
      }
      const sentences = data.source.match(
        /[^\n.!?]+(?:[.!?](?=\s|$)|$)|[^\n]+/g,
      ) || [data.source]
      const words =
        (field.label + ' ' + field.hint).toLowerCase().match(/[a-z]{3,}/g) || []
      const ranked = sentences
        .map((text, index) => ({
          text,
          index,
          score: words.filter((word) => text.toLowerCase().includes(word))
            .length,
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
      const source = ranked
        .slice(0, 16)
        .sort((a, b) => a.index - b.index)
        .map((item) => item.text.trim())
        .join('\n')
        .slice(0, 4500)
      const format = {
        number: 'a number',
        text: 'the shortest exact phrase',
        date: 'a date in YYYY-MM-DD format',
        'yes/no': 'yes or no followed by an exact quote',
      }[field.type]
      const messages = [
        {
          role: 'system',
          content:
            'Answer using only the job listing. If the answer is missing, answer UNKNOWN. Respond with only the answer.',
        },
        {
          role: 'user',
          content:
            'Listing:\n' +
            source +
            '\n\nWhat is the ' +
            field.label +
            '? ' +
            field.hint +
            ' Return ' +
            format +
            '.',
        },
      ]
      const output = await run(messages, {
        max_new_tokens: 32,
        do_sample: false,
        return_full_text: false,
      })
      const entry = (
        output as Array<{ generated_text: string | Array<{ content: string }> }>
      )[0].generated_text
      const answer = (
        typeof entry === 'string' ? entry : entry.at(-1)?.content || ''
      ).trim()
      if (
        !answer ||
        /\bunknown\b|not (specified|provided|mentioned)/i.test(answer)
      )
        continue
      let value = answer
        .split('\n')[0]
        .trim()
        .replace(/^["']|[."']$/g, '')
      if (field.type === 'number')
        value = answer.match(/-?\d+(?:\.\d+)?/)?.[0] || ''
      if (field.type === 'date')
        value = answer.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || ''
      let evidence = value
      if (field.type === 'yes/no') {
        value = answer.match(/^(yes|no)\b/i)?.[0]?.toLowerCase() || ''
        evidence = answer
          .replace(/^(yes|no)[\s:,.–—-]*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim()
      }
      if (!evidence || !value) continue
      const quote = sentences
        .find((sentence) =>
          sentence.toLowerCase().includes(evidence.toLowerCase()),
        )
        ?.trim()
      if (!quote) continue
      // Qualifiers distinguish total project hours from weekly hours, and start dates from closing dates.
      if (
        /week/i.test(field.label) &&
        field.type === 'number' &&
        !/week|\/wk\b/i.test(quote)
      )
        continue
      if (
        /deadline|closing date/i.test(field.label) &&
        field.type === 'date' &&
        !/deadline|clos|submit|apply|applications?|accept|until|respond by|due/i.test(
          quote,
        )
      )
        continue
      if (
        /\b(tool|software|company|client)\b/i.test(field.label) &&
        field.type === 'text' &&
        value.split(/\s+/).length > 5
      )
        continue
      found.push(
        ...suggestions([{ id: field.id, value, quote }], data.source, [field]),
      )
    }
    self.postMessage({ status: 'done', rows: found, requestId: data.requestId })
  } catch (error) {
    engine = undefined
    self.postMessage({
      status: 'error',
      message: String(error),
      requestId: data.requestId,
    })
  }
}
