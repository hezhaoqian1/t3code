# Attachment Preparation

The FD provider owns model-dependent attachment preparation. The orchestration
reactor forwards original attachment metadata without extracting documents or
discarding them. `FdDeepSeekDriver` injects `prepareAttachments` into the adapter;
the adapter serializes preparation per thread, publishes progress, and aborts it
on interruption, session shutdown, or its ten-minute total deadline.

`AttachmentWorkerClient` runs PDF parsing and rendering, image tiling, and modern
document parsing in a worker with a three-minute deadline and 512 MiB V8 heap
limit. Native allocations are additionally bounded by image pixel and output byte
limits. `attachmentWorker.mjs` is a second server build entry. It must be included
with all generated chunks, PDF.js assets, and the native canvas dependency in
releases.

## PDFs: text first, pages on demand

`VisualAttachments.processPdf` reads every page (up to 500) with PDF.js and
`PdfPages`:

- `layoutPageText` rebuilds reading order from text item positions. Items on one
  baseline become one line; a gap wider than about 0.6 of the font size becomes
  `" | "`, so table rows keep their columns.
- `rasterImageCoverage` tracks the transformation matrix through the operator
  list (save/restore/transform and form XObjects) to measure how much of the page
  raster images cover.
- `classifyPdfPage` marks a page `text` (images under 5% of the page, such as a
  running header logo), `figure` (text plus a chart or picture), or `scanned`
  (under 30 characters with a large image, or no text at all).

Only scanned pages are rendered before the turn, at most 40; the rest are listed
as deferred. Chart pages are not recognized up front: their text is in the
prompt, and the model looks at the page when the question needs it. A
`renderPages` work item renders specific pages on demand.

`prepareAttachments` writes the parsed pages to a cache beside the attachment
(`<attachment id>.pdfpages`, no extra dots, so the projection's attachment
cleanup deletes it with the thread), then builds the prompt within a 200 KB
UTF-8 budget: the question, pasted text, recognition evidence (at most 60 KB),
document text, and a `[PDF 附件说明]` guide. Document text is added whole page
by whole page; once a PDF's page does not fit, its remaining pages are omitted
and listed in the guide with their titles. The guide names chart pages, scanned
pages (recognized or deferred), omitted pages, the document id, and which tool
reads each. It also warns that printed page numbers can differ from PDF page
positions.

Recognition (scanned pages, large image tiles, and chart pages for sessions
without page tools) goes through `PageRecognition.recognizePages`: three pages
at a time, retrying transient `FdResponsesError` kinds twice with backoff. A page
that still fails becomes a labelled `[本页未能识别]` entry plus an
`[附件识别提示]` note; it does not discard the other pages. `FdVisionService`
keeps the first 24 KB of an overlong page and says it was cut instead of
failing. Cancellation still stops everything.

## Page tools

`PdfPageTools` registers two Codex dynamic tools for every FD Codex session
(`FdCodexAdapter` merges them with an FD Skill's enterprise tools; an
enterprise tool with the same name would win):

- `fd_pdf_read_pages(document_id, pages)`: cached page text, up to 20 pages and
  30 KB per call, with notes pointing chart and scanned pages at the viewer.
- `fd_pdf_view_pages(document_id, pages)`: renders up to 4 pages in the worker
  and recognizes them in parallel with the thread's latest model when it has a
  native visual route, otherwise with the authorized `deepseek-flash`
  preprocessor. Results are cached per page and model
  (`<attachment id>.vision-p<N>-<model>`).

Tools only open attachments whose id carries the calling thread's segment. The
thread's model comes from `FdDeepSeekAdapter`'s `observeTurnModel` hook. If the
text cache is missing, the tool parses the PDF again without rendering.

Codex keeps only 10 KB of each tool result for custom models, so the managed
`config.toml` sets `tool_output_token_limit = 16000`.

## Other attachments

Ordinary small images retain their native input route. Large images become
2048px tiles with 128px overlap in reading order; a cut through visible content
moves to a uniform background row within the overlap when one exists. Visual
extraction marks clipped edge characters as incomplete instead of guessing.
Qwen/GLM do not silently use another model for standalone images. Every result
is labelled with its source and supplied as untrusted evidence.

Legacy DOC/PPT conversion uses a standard installed LibreOffice executable with
a temporary profile and macros disabled. Conversion runs outside the worker so
cancellation can terminate the process. Converted files and the temporary profile
are removed after processing. LibreOffice is optional and is not bundled.

## Verification

- Server: `pnpm exec vp test run src/fileAnalysis src/fd-vision src/fd-codex/FdDocumentTools.test.ts src/fd-codex/ResponsesCodexConfig.test.ts src/provider/Layers/FdAttachmentPreparation.test.ts`
- Renderer: `pnpm exec vp test run src/lib/imageCompression.test.ts src/lib/documentAttachments.test.ts`
- Server bundle: `pnpm exec vp pack --out-dir test-artifacts/attachment-bundle`
- Packaged worker: `node scripts/attachment-smoke.mjs` from `apps/server`.

Generated fixtures cover text, chart and scanned pages, table row layout, image
coverage through nested transforms, budgets, page omission, retries, partial
failure, cancellation, the page tools' thread scoping and caching, and model
routing. These are local checks; a release also needs a real desktop run with a
long chart-heavy PDF. Do not equate mock model responses with live recognition.
