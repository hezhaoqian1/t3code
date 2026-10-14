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

## Turn budget

A prepared turn carries at most 200,000 UTF-8 bytes
(`PREPARED_PROMPT_MAX_BYTES`), about a quarter of the 258,400-token window Codex
manages for these models. The rest of every attachment stays readable through
the attachment tools, so the budget limits what arrives up front, not what the
model can read.

After the question and a reserve for the guides, pasted text (up to 120 KB),
recognition results (up to 60 KB) and document text share the room by
water-filling (`fairShares`), so a large paste cannot leave a contract out
entirely; document text also gets whatever the others leave. If the composed
prompt still overflows, `prepareAttachments` shrinks what can be read again
later, in this order: document text, pasted text, recognition results. It never
fails the turn for attachment size. Only a typed message that alone exceeds the
budget is refused, with a hint to send it as a file.

Before 0.2.41 the turn failed with "附件与问题的总文本超过本轮容量" far too
often: documents were capped at 160,000 characters but checked against 200,000
bytes (a Chinese character is three bytes), and the Office walker emitted every
Word paragraph twice and table cells three times or more, because officeparser
already puts the combined text of a node's children on the node. A Chinese
contract of about 33,000 characters was enough.

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

`PdfPageTools` and `SheetTools`, combined by `combineAttachmentTools`, register Codex dynamic tools for every FD Codex session
(`FdCodexAdapter` merges them with an FD Skill's enterprise tools; an
enterprise tool with the same name would win):

- `fd_pdf_read_pages(document_id, pages)`: cached page text, up to 20 pages and
  30 KB per call, with notes pointing chart and scanned pages at the viewer.
- `fd_pdf_view_pages(document_id, pages, focus?)`: renders up to 4 pages in the
  worker. When the thread's latest model has a native visual route, the tool
  result carries the page images themselves (`inputImage` content items after a
  text header), so the model reads charts with its own eyes and can look again.
  Other models get a reading by the authorized `deepseek-flash` preprocessor,
  pages in parallel; a full reading is cached per page
  (`<attachment id>.vision-p<N>-deepseek-flash`). `focus` asks the
  preprocessor for one specific value instead (for example a curve's peak and
  its date) and is never cached. A focused reading renders each page as two
  overlapping halves (`splitPages`, split across the longer side) and sends
  both in one request. The Aliyun Responses route accepts images in
  `function_call_output` for every native-vision model in the catalog.

Both PDF tool descriptions and `[PDF 附件说明]` say that attachment files are
not in the workspace and must be read through the tools: without that, a model
once spent minutes running `Get-ChildItem -Recurse` over the user's profile
looking for the PDF and cropping it with Python.

Every page reading and every page image comes with a chart rule: confirm each
series' color from the legend, follow only that color, name the axis used, and
read dates from the tick under the point.

The vision route shrinks every image to a fixed budget (about 1,000 image
tokens for a whole A4 page), which leaves chart ticks and legends barely
legible. With a whole page, the preprocessor took a yellow ROE spike on a
dual-axis chart for the blue PE line's peak, or misread its date, in about half
the runs; with two halves (about 1,450 tokens) it read the right date every
time, in the same 6-7 seconds. Medium reasoning on top added about 45 seconds
for little gain, so readings run without reasoning.

Tools only open attachments whose id carries the calling thread's segment. The
thread's model comes from `FdDeepSeekAdapter`'s `observeTurnModel` hook. If the
text cache is missing, the tool parses the PDF again without rendering.

Codex keeps only 10 KB of each tool result for custom models, so the managed
`config.toml` sets `tool_output_token_limit = 16000`.

## Spreadsheets

Workbooks are read up to 200,000 rows per sheet. Every sheet is written as a
UTF-8 CSV beside the attachment (`<attachment id>.sheet<N>-csv`, one record per
line, in-cell line breaks flattened) with a `<attachment id>.sheets` manifest;
attached CSV/TSV files get a manifest that points at the file itself. The
section text holds the first 2,000 rows.

`formatAttachmentDocuments` gives every attachment a fair share of the byte
budget (water-filling), then cuts tables at row boundaries and reports how many
rows went in. `[表格附件说明]` lists each partial table with its size, the rows
included and the CSV path, and tells the model to read more rows with
`fd_sheet_read_rows` (up to 500 rows and 30 KB per call, header always first)
or to compute over the CSV with a command. Before this, a few thousand rows of
Chinese text made the turn fail the 200 KB check.

## Word, PowerPoint, text and pasted text

`DocumentContext` cuts a long body at the budget and records how many lines it
carried (`cutSections`); slides go in whole and the rest are listed
(`omitted`). `[文档附件说明]` gives each such document's id, its total lines, and
where to continue: the line the prompt stopped on, or the first slide left out
and the line it starts on. The in-text marker repeats the line range.

`fd_document_read(document_id, lines | search)` reads up to 1,000 lines and
30 KB per call, or returns up to 40 lines containing a keyword with their line
numbers. The text comes from `<attachment id>.doctext`, written for every
document the turn cut and for every paste, laid out as `layoutDocumentText`
does (a header line per page or slide); if it is missing the tool parses the
file again. Pasted text is marked as the employee's own words rather than
untrusted content. PDFs and tables are redirected to their own tools, and only
the calling thread's documents open.

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

- Server: `pnpm exec vp test run src/fileAnalysis src/fd-vision src/fd-codex/FdDocumentTools.test.ts src/fd-codex/ResponsesCodexConfig.test.ts src/provider/Layers/FdAttachmentPreparation.test.ts`.
  `Capacity.test.ts` sends a worst-case turn: a 600 KB paste, a 6,000-line
  contract, 80 slides, three 300-page PDFs and 42 recognized images.
- Renderer: `pnpm exec vp test run src/lib/imageCompression.test.ts src/lib/documentAttachments.test.ts`
- Server bundle: `pnpm exec vp pack --out-dir test-artifacts/attachment-bundle`
- Packaged worker: `node scripts/attachment-smoke.mjs` from `apps/server`.

Generated fixtures cover text, chart and scanned pages, table row layout, image
coverage through nested transforms, budgets, page omission, retries, partial
failure, cancellation, the page tools' thread scoping and caching, and model
routing. These are local checks; a release also needs a real desktop run with a
long chart-heavy PDF. Do not equate mock model responses with live recognition.
