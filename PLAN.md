# Jobclipper browser extension

## Project location

Keep the package manifest, lockfile, source, tests, and build output under `C:\Users\eduardo\Desktop\Projects\windows-overlay\sideprojects\jobclipper`.

## MVP

Build a private-pilot extension for Chrome and Edge on Windows. An applicant opens a listing, clicks **Jobclipper**, reviews an editable card beside the page, and presses **Log application**. History retains the reviewed description after the original listing disappears.

## Technology stack

| Layer | Choice |
|---|---|
| Extension and UI | TypeScript, WXT, Manifest V3, React, plain CSS, and the Chromium side panel API |
| Page capture | `activeTab`, `chrome.scripting`, rendered DOM, and Schema.org `JobPosting` data |
| Local model | Transformers.js with ONNX Runtime Web in a dedicated CPU/WASM worker. Start with SmolLM2-360M-Instruct INT8 and validate it on an 8 GB laptop. |
| Storage and validation | IndexedDB through Dexie for application records and custom field definitions. Zod for extracted values. |
| Testing | Vitest for extraction and persistence logic, Playwright for packaged-extension flows, and manual smoke tests in Chrome and Edge |

## Implementation milestones

1. **Prove one complete capture.** Scaffold the extension, open the side panel, capture one listing, save an edited record, and retrieve it after a restart. Benchmark the packaged model early. Show its download size before opt-in and keep basic capture available during download or inference failure.
2. **Support the pilot job boards.** Start with Upwork, OnlineJobs.ph, and Indeed. Capture the active listing’s title, company or client, description, source, and direct URL together. Prefer matching structured data, then the visible listing container. Offer **Use selected text** on ambiguous pages and **Paste job text** with an editable URL on inaccessible pages.
3. **Add review and custom fields.** Require a title and URL to save. Default **Date applied** to the applicant’s local date and allow backdating. Support text, number, date, and yes/no fields. Give every field a stable ID and a choice of **Extract from listing** or **Fill in myself**.
4. **Connect local inference.** Bundle the executable runtime with the extension and cache the model after download. Use listing text to fill missing extractable values. Require a supporting phrase, validate each suggestion, and leave unsupported values blank. Protect user edits from late results and release the worker after inactivity.
5. **Finish history and pilot packaging.** Support search by title, company, and site, editing saved records, and reopening the original listing. Detect repeat captures by posting ID or direct listing URL. Package an unpacked build with installation instructions for both browsers. Defer integrations and account sync until after the pilot.

## Acceptance criteria

- Capture a real listing from each pilot site in both browsers. On split-view boards, switching jobs captures the selected job’s title, description, and link together.
- Save a manually corrected record, restart the browser, and recover its description, application date, and custom values. A listing’s posting date must never populate **Date applied**.
- On an 8 GB Windows laptop with normal tabs open, target an editable card within two seconds and typical warm extraction within 15 seconds. Users can edit and save while inference runs.
- Evaluate 30 labeled English-language listings. Target at least 90% accuracy among populated custom-field suggestions and report the share of available values recovered.
- Verify duplicate detection, selected-text capture, interrupted model download, and offline extraction from pasted text after the model is cached.

For installation instructions and observed pilot results, see the [README](README.md).
