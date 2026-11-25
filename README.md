# Jobclipper

Jobclipper is a private-pilot Chrome and Edge extension for logging job applications on Windows. It captures the listing open in the browser and saves the reviewed record in that browser profile.

## Install the unpacked pilot

1. Open **Extensions → Manage extensions** in Chrome or Edge.
2. Turn on **Developer mode**, click **Load unpacked**, and select the `.output/chrome-mv3` directory inside this project. Choose the directory containing `manifest.json`.
3. Pin **Jobclipper**. Open an individual listing and click the toolbar icon. Review the title, application date, description, and other fields, then click **Log application**.
4. Open **History** to search, correct a saved application, or reopen its listing. Chrome and Edge keep separate histories. Removing the extension clears its local data.

## Capture and extraction

- Jobclipper reads the active tab when invoked. It looks for matching JobPosting metadata, a selected job pane, and readable job details. The saved description retains paragraphs and bullets.
- On a results page, highlight one job and click **Use selected text**. On restricted pages, paste the description and supply the listing URL. The application date defaults to the local date of capture and can be backdated.
- In **Settings**, add a text, number, date, or yes/no field. Choose **Extract from listing** for published facts or **Fill in myself** for information such as the applicant's bid. Editing a field label preserves its saved values.
- Choose **Download and enable model** for local extraction. The first download includes approximately 363 MB of INT8 weights plus tokenizer and configuration data from Hugging Face. JavaScript and the ONNX WASM runtime ship with the extension. Once cached, the model can run offline.
- Extracted fields show supporting text. A missing fact stays blank. **Extract fields** runs extraction again after a paste or a failed download. Capture, editing, and saving work with the model disabled.
- Application history lives in IndexedDB. The current capture uses browser session storage, and the model uses the browser cache. Disabling the model stops inference and keeps its downloaded files available for later use.

## Development

Use Node.js 22.18 or newer and npm. From this directory on Windows run:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium --no-shell
npm.cmd run e2e
```

The project uses WXT and TypeScript for the Manifest V3 extension, React for the side panel, Dexie for IndexedDB, Zod for validation, and Transformers.js for SmolLM2-360M-Instruct. The lockfile pins the JavaScript dependencies and the worker pins the model revision. The build copies the matching ONNX runtime files into the unpacked directory.

## Pilot validation

`npm.cmd test` checks listing extraction, split-view ambiguity, duplicate identity, evidence validation, and persistence. `npm.cmd run e2e` exercises the packaged extension through its toolbar action, including recovery from a failed model download.

After building, run either evaluation from this directory:

```powershell
node tests/benchmark.mjs
node tests/benchmark.mjs --live
```

The first command evaluates 30 authored English examples, including missing and misleading values. The second gathers 30 public OnlineJobs.ph listings and compares extracted weekly hours, employment type, or advertised pay to the site's visible labels. Exact label matches use the same deterministic extraction path as the extension. The live run caches its sample locally for repeatable comparisons. Both runs start a fresh worker offline after loading the model, record median warm processing time and precision and recall, and write individual outcomes under `.cache/benchmark`. On Windows the harness also samples total working-set memory for its isolated browser processes.

To check current site compatibility, pass individual public listing URLs to `node tests/live-smoke.mjs`. The script invokes the extension in fresh Chrome and Edge profiles and reports HTTP status, title, captured length, and time to the editable draft. Access challenges require testing in a normal browser session where the listing is visible.


### Results for version 0.1.0

| Check | Observed result |
|---|---|
| Build and regression tests | TypeScript passed. All 11 unit tests and three packaged-browser tests passed. |
| Live OnlineJobs.ph toolbar capture | A public listing produced a title and 3,556 characters of job facts and description in both installed browsers. The editable card appeared in 208 ms in Chrome and 209 ms in Edge. |
| Live Upwork and Indeed toolbar capture | Both sites returned HTTP 403 to the clean test profiles. Jobclipper left the draft available for manual entry. Successful live capture on these sites still needs a session that can view the listing. |
| 30 public listings with labeled fields | All 30 requested values matched their published labels using deterministic extraction. This sample covers hours, type of work, and pay on OnlineJobs.ph. |
| 30 authored free-text examples | 17 correct out of 18 suggestions, recovering 17 of 23 available values. Median warm processing time was 2.73 seconds per field. The examples were used during development. |
| Offline inference and memory | The cached model loaded in a fresh worker offline. Peak sampled working set for the entire test browser was 1,931 MiB during the free-text run on a Windows host with 31.7 GiB RAM. The 8 GB laptop target remains unverified. |

### Suggested fields and refreshed listings

In **Capture**, Jobclipper offers **Suggested fields** when the listing contains recognizable facts such as weekly hours, pay, or a labeled schedule. Click **Add** to keep the field and its value. These suggestions also work with the local model disabled.

Click **Refresh listing** after a posting changes or after selecting another listing. Refresh reads the current browser tab and preserves edits for the same job. When Chrome or Edge requires permission on a new tab or site, click the Jobclipper toolbar icon there once.
