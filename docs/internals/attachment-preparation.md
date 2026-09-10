# Attachment Preparation

The FD provider owns model-dependent attachment preparation. The orchestration
reactor forwards original attachment metadata without extracting documents or
discarding them. `FdDeepSeekDriver` injects `prepareAttachments` into the adapter;
the adapter serializes preparation per thread, publishes progress, and aborts it
on interruption, session shutdown, or its ten-minute total deadline.

`AttachmentWorkerClient` runs PDF rendering, image tiling, and modern document
parsing in a worker with a 90-second deadline and 512 MiB V8 heap limit. Native
allocations are additionally bounded by image pixel and output byte limits.
`attachmentWorker.mjs` is a second server build entry. It must be included with
all generated chunks, PDF.js assets, and the native canvas dependency in releases.

PDF.js extracts text page by page. For a visual model, every page is rendered,
including pages with both text and charts. Large pages and long images use 2048px
tiles with 128px overlap in reading order. Text-only routes reject pages without
text or containing raster images and warn that chart/layout analysis was omitted.
The shared format map controls the renderer picker and server attachment paths.

Ordinary small images retain their native input route. PDF pages and large image
tiles are recognized sequentially by the selected Kimi model, or by the existing
authorized FD DeepSeek visual preprocessor. Qwen/GLM do not silently use another
model. Every result is labelled with its source and supplied as untrusted evidence.
This is visual extraction, not a claim of native PDF API support. Model requests
incur normal gateway usage; page evidence is not a lossless PDF representation.

Legacy DOC/PPT conversion uses a standard installed LibreOffice executable with
a temporary profile and macros disabled. Conversion runs outside the worker so
cancellation can terminate the process. Converted files and the temporary profile
are removed after processing. LibreOffice is optional and is not bundled.

## Verification

- Server: `pnpm exec vp test run src/fileAnalysis/VisualAttachments.test.ts src/fileAnalysis/PrepareAttachments.test.ts src/fileAnalysis/DocumentParser.test.ts src/fd-vision/FdVisionService.test.ts src/provider/Layers/FdAttachmentPreparation.test.ts`
- Renderer: `pnpm exec vp test run src/lib/imageCompression.test.ts src/lib/documentAttachments.test.ts`
- Server bundle: `pnpm exec vp pack --out-dir test-artifacts/attachment-bundle`
- Packaged worker: `node scripts/attachment-smoke.mjs` from `apps/server`.

Generated fixtures cover mixed text/scanned PDFs, rendered pixel checks, long-image
coverage, format containers, budgets, cancellation, and model routing. The ASAR
smoke exercises the bundled worker through Electron without opening a user profile.
These are local checks; a release also needs authenticated gateway acceptance with
synthetic pages for Kimi and the authorized DeepSeek vision alias. Do not equate
mock model responses with live recognition or deploy merely because unit tests pass.
