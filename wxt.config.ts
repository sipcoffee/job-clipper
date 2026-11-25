import { defineConfig } from 'wxt'
export default defineConfig({
  manifest: {
    name: 'Jobclipper',
    description:
      'Capture a job listing and keep a private application history.',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage'],
    action: { default_title: 'Capture with Jobclipper' },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  vite: () => ({ worker: { format: 'es' } }),
  hooks: {
    'build:publicAssets': (_, files) => {
      for (const ext of ['wasm', 'mjs']) {
        const name = 'ort-wasm-simd-threaded.jsep.' + ext
        files.push({
          absoluteSrc:
            process.cwd() +
            '/node_modules/@huggingface/transformers/dist/' +
            name,
          relativeDest: 'runtime/' + name,
        })
      }
    },
  },
})
