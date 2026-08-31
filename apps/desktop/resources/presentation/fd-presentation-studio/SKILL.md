---
name: fd-presentation-studio
description: Create, edit, replicate, read, and export presentations. For every PPT task, the default deliverables are BOTH (1) a self-contained PPTD project folder containing the .pptd manifest plus pages/media dependencies and (2) a locally generated .pptx with embedded fonts and fade slide transitions. Use for any presentation, PowerPoint, PPT/PPTX, slide deck, PPTD, infographic, or poster task unless the user explicitly requests another format. Deliver with normal local file/folder links using absolute paths.
---

# Definition

FD Presentation Studio is a presentation creation and export capability built around a local PPTD format and browser-side PPTX writer. It defines a YAML-format intermediate DSL (`.pptd`) that abstracts OOXML and keeps each page self-contained.

## Desktop product mode

Inside Fangde AI Desktop, the Desktop host owns the runtime. Never ask an employee to install Node.js, npm, npx, Python, Chromium, packages, cookies, or API keys, and never instruct them to open localhost or run shell commands. Reuse the current task workspace and attachments; the host provides the pinned editor assets and exporter. Present the editable project and PPTX as Fangde AI artifacts without mentioning upstream product names.

### Desktop-safe Chinese fonts

Use fonts that are available in the bundled editor and common employee desktop
installations. For Chinese serif titles, use `Songti SC`; for Chinese sans-serif
body text, use `PingFang SC`. When a field supports explicit East Asian font
mapping, prefer `{latin: "Liter", ea: "PingFang SC"}` for body text and
`{latin: "Georgia", ea: "Songti SC"}` for serif titles. Do not use `MiSans` or
`Noto Serif SC` in generated PPTD unless the exact font file is bundled locally;
unresolved font names render Chinese glyphs as empty squares in exported previews.

### Managed project contract

For a new presentation, create exactly one self-contained project directory under
`<current task workspace>/presentations/<short-slug>/`. The directory must contain
one `<short-slug>.pptd` manifest, its `pages/` and `media/` dependencies, and the
matching `<short-slug>.pptx` after export. Reuse the same directory when a later
turn asks to modify the presentation. Do not scatter pages or temporary files in
the task root. When more than one project exists, use the artifact selected by
the current turn; otherwise use the most recently updated project in
`presentations/`. The assistant's final message should describe the result in
plain Fangde language and must never mention Kimi, Moonshot, upstream skill names,
or implementation tokens.

**The default output is not PPTD-only.** Unless the user explicitly opts out, always produce both:

1. the complete editable PPTD project directory (`.pptd` + `pages/` + `media/` and other referenced dependencies);
2. the matching locally generated `.pptx`, with font embedding enabled and fade slide transitions applied by default.

Existing PPTX files may also be converted into PPTD for editing, after which both outputs are delivered again.

## The pptd format

The .pptd format is a simplified abstraction layer over OOXML that follows basic YAML syntax. This abstraction preserves the core content of OOXML (theme, page layout, element positions and definitions, etc.) while removing complex nesting logic such as Masters; every page is self-contained — what you see is what you get. Read reference/pptd.md for the complete definition of this DSL.

## PPT production workflow

### step0. Use the desktop runtime

Default delivery includes PPTX export through the pinned local WASM worker. Use `FD_PRESENTATION_NODE` and `FD_PRESENTATION_SKILL_ROOT` when supplied by Desktop. The production path is self-contained and offline; do not probe or depend on the employee's PATH.

### step1. Read the context thoroughly

Read **all files uploaded by the user**, the provided URLs, and the pptd format guide `reference/pptd.md` to fully understand the user's requirements.

### step2. Understand the user's requirements

Understand the user's requirements based on the context:

1. First determine the purpose of the request

- Create a PPT: create a new presentation (from scratch, or from an existing pptx template)
- Edit a PPT: edit the user's uploaded PPT (local modifications, single-page beautification, etc.)
- Replicate a PPT: replicate a presentation from a non-pptx format (images, PDF, etc.) into pptd format

2. Then determine the design direction

- Self-directed design: no preference, or only simple style constraints given; you need to fill in or create the design
- Design system: a preset design system from the skill (`reference/design_system/`) is specified, or the user provides a complete and detailed design scheme covering all color, font, layout, and component specifications
- Use a template: a template is provided and must be used
- Style transfer: a style reference source is provided (images, web pages, etc.)

3. Then determine the input type

- Topic only: only a PPT topic direction or content requirements for the presentation are given, with no concrete content
- Full document: the user provides a complete document (paper, research report, press release, etc.)
- Outline: the user provides a page-by-page outline, speech script, or similar content

* When the "user input type" is [Full document] or [Outline] and it is not specified whether expansion is allowed: since a page-by-page outline, speech script, or user document can hardly support the full content of a presentation, prefer using search to expand with more relevant material, cases, etc., unless the user explicitly says not to expand

4. Finally determine the exact page count

- If the user requests a specific page count, the user's requirement takes priority
- Page-by-page outline/script provided: match the number of pages in the outline/script
- When a complete and relatively structured document is provided: ask the user how much document content one page should cover, and give an estimated total page count; when only a topic is provided: suggest a recommended page count and confirm with the user

#### Clarification and follow-up questions

When any of the following situations arise, resolve them by asking the user (use the agent's ask/clarification tool when available)

1. Requirements are ambiguous

- The user's intent is unclear or hard to understand
- The files/URLs provided by the user are inaccessible

2. Conflicting intents

- The user's intents contradict each other. For example:
  - A design system is selected while also requesting a style that is completely inconsistent with that design system (e.g., using a McKinsey style while requiring large areas of whitespace on pages) / using a template / referencing an image style
  - Requesting both "make 10 pages" and "deliver 30+ pages of output"

3. Unable to determine the user's requirements on your own

- When the purpose, design direction, input type, page count, etc. are hard to determine by yourself

### step3. Generate the presentation based on the user's requirements

Before generating, first read `reference/pptd.md` to understand the pptd format definition and constraints.

#### Replicating a PPT

- Analyze the images to estimate element positions, fonts and sizes, etc., and **replicate 1:1 as closely as possible**.
- For parts that are difficult to make out, use methods such as grid lines and close-up views to improve understanding.
- Replicate simple content in the image with elements; icons may be approximated with icons provided by Font Awesome. For content that cannot be approximated with icons or shapes, such as photos and avatars, use tools such as bash or python to crop and split the original image, then add the resulting image elements to the presentation

#### Editing a PPT

- Convert the user's uploaded pptx file to .pptd format
- Review the converted pages (structure and key visual details). Read a few key pages individually afterwards.
- Locate the pages to edit, and be careful not to affect parts outside the intended scope.
  > Conversion from pptx to pptd is not perfectly lossless. If the user later reports format errors, garbled content, etc., compare against the original pptx and repair the pptd with reference to the comparison

#### Generating a PPT

When generating a PPT, adopt different production approaches for different user [design directions]

##### Self-directed design

1. Read the design guide `reference/slides_categories.md`, and read the scenario document corresponding to the user's query
2. Produce the presentation based on the above

#### Generating content in other formats

- When the user explicitly asks for an infographic, poster, or a highly visual single-page design, read `reference/general-poster.md` and implement it as a single-page or few-page editable PPTD; when the user only asks for an image, still build it with PPTD first, then output the image via screenshot or rendering. Do not load this reference file for ordinary PPT requests.

##### Design system

1. Read the general constraints section of the `reference/slides_categories.md` guide, and read the scenario document corresponding to the user's query as the design foundation
2. Read the specified design system as the presentation style: either the user-provided design scheme, or the matching preset under `reference/design_system/` (search by name / path the user specified; prefer the folder's `design.md` when present). It is strictly forbidden to reference or mix in other design styles
3. Produce the presentation with reference to the above
4. Do not auto-pick a preset during self-directed design; only use `reference/design_system/` when a preset is explicitly specified

##### Using a template

1. Convert the user's uploaded pptx file into pptd form
2. Review the converted pages to understand the template's visual style (color scheme, font style, element characteristics, layout characteristics, content density, etc.)
3. Identify page types; focus on reading special pages such as the cover, summary pages, and section dividers (single-page screenshots, .page files), extracting their page layouts, content structures, reusable components (icons, shapes, smartart, reusable body layout schemes, etc.), and element styles (e.g., whitespace/line/card separators, square/rounded corners, etc.)
4. Produce the presentation using the template

##### Style transfer

1. Analyze the reference file's visual style (color scheme, font style, element characteristics, layout characteristics, content density, etc.), page layouts, content structures, reusable components (icons, shapes, smartart, reusable body layout schemes, etc.), and element styles (e.g., whitespace/line/card separators, square/rounded corners, etc.).

- If the user provides a style reference URL, do not only read the text content; refer to and learn from the page's visual effect more to help understand the style

2. Produce the presentation using the reference file's style characteristics. You are encouraged to reuse illustrations, fonts, font-size hierarchies, elements, etc. from the original pdf/url

##### Images and Visual Materials

1. Images are an effective way to enrich a presentation's visual impact. Appropriate images should be used not only on covers and section dividers, but also on body pages to enrich the page, aid understanding, or support decision-making
2. Images are used to show concrete subjects, explain content, provide evidence, or establish a scene. Logos, icons, decorative textures, and very small thumbnails do not count as substantive imagery.
3. When a page involves products, people, places, buildings, events, cases, interfaces, experimental subjects, or spatial environments, prioritize corresponding real images or screenshots. If real images and screenshots cannot be obtained, generated images may be used instead.
4. Image priority: images provided by the user; images from official websites, official reports, and credible sources; searched images that are directly relevant to the content; images generated for conceptual expression or atmosphere.
5. After deciding which images are needed, complete image search, generation, and downloading in a batch before designing pages around their proportions. Save images in the `media` directory, keep them clear, and never stretch or distort them.
6. Analytical, technical, and academic PPTs should use corresponding evidence images when products, experiments, interfaces, cases, or on-site materials are available. Do not reduce every page to text, color blocks, and shapes.
7. Do not add irrelevant images merely to meet a quantity target. Every image must be directly relevant to the page's conclusion or communication goal.

##### Content Guidelines

1. Language style: unless the user explicitly requests otherwise, strictly avoid overly abstract expressions and uncommon metaphors

- Do not overuse metaphors, slogans, or abstract jargon such as distribution, an N-step argument, everything at a glance, a closed loop, hands-on practice, verification, deconstruction, second-class citizens, poison pills, or wall clocks
- Do not use common AI phrasing such as “not X, but Y,” “X is Y,” “why / based on what / how,” “key takeaway,” or “N battlefronts / paths”
- Do not use overly colloquial expressions such as “where should the ammunition go,” “the Nth thing,” “can't pick the right one,” or “cannot be used as X”

### step4. PPT validation

1. Validate the generated pptd against the format definition in `reference/pptd.md` (required fields, types, bounds, theme tokens, resource paths, etc.) and repair issues over multiple rounds
2. Visual review with exported page images — **required before PPTX export when the model supports image input (multimodal)**:
   - Maintainers may run the bundled image QA harness against the local editor mirror before a release. This is not part of the employee workflow and does not contact external services.

     ```bash
     # Maintainer-only QA command; Desktop releases invoke the equivalent bundled check.
     ```

     The script prints a JSON summary mapping each stitched label (`P1`…`Pn`, 1-based page order) to its `.page` file.

   - Read the stitched overview image (`.qa-images/overview.jpg`) and check every page against this list:
     1. 图片是否清晰、不变形（无拉伸、压缩、模糊）
     2. 文字是否压在关键画面（人脸、产品主体、Logo 等）上
     3. 元素坐标是否超出页面边界
     4. 边界与配色对比是否足够（文字与背景、相邻色块之间）
     5. 排版是否统一（对齐、间距、字号层级、页边距）
     6. 文字是否可能溢出文本框（文本过长、行距过密、字号过大）
     7. 内容是否被上层元素遮挡
   - For any suspicious page, read its full-resolution image (`.qa-images/pages/<n>.jpeg`) to confirm the problem before editing.
   - Fix issues in the corresponding `.page` file, then re-run `scripts/export_images.py --force` and review the new overview; repeat until every page passes.
   - Do not export the PPTX until the visual review passes. `.qa-images/` is an intermediate QA artifact and may be deleted after delivery.

3. When the model cannot read images, fall back to a structural review of the generated pages (bounds, overflow-prone long text, contrast, hierarchy, layout density) over multiple rounds, and state that image-based visual QA was skipped.

### step5. PPT output and delivery

1. Always produce a self-contained project directory. Keep the `.pptd` manifest and every referenced dependency together; never deliver a standalone manifest without its referenced files. Use this layout unless an existing project already has a valid equivalent structure:

   ```text
   deck/
     deck.pptd
     pages/
       *.page
     media/
       *                # when the deck has local media
     deck.pptx          # generated by default
   ```

2. Generate the `.pptx` by default after PPTD validation, even when the user only asks to create or edit a presentation. Skip PPTX export only when the user explicitly requests PPTD-only output or the environment cannot run the exporter; in the latter case, report the exact blocker and still deliver the complete PPTD project.
3. Deliver with normal clickable local links using absolute paths. In the final response, link all of the following:
   - the project directory;
   - the `.pptd` manifest;
   - the `pages/` directory and `media/` directory when present;
   - the generated `.pptx` file.
4. PPTX conversion: ask the Desktop host to invoke the pinned local WASM worker. It runs offline with no cookie, signature API, browser UI, or external command.
5. Default PPTX options:
   - page transition: `fade` (淡入淡出), written to every slide after export;
   - font embedding: available on the browser path; local WASM path prioritizes reliability over embed;
   - override with `--transition none` or force browser UI with `--browser`.
6. The Desktop host receives the project directory, creates the matching `.pptx`, and returns structured artifact metadata. A project directory must contain exactly one `.pptd` manifest. Existing output is replaced only through an explicit retry action.
7. Offline model (本地编辑器 + 本地导出):
   - **PPTX export (default)**: local patched WASM via `scripts/local-export/export-pptd.mjs --no-sign`. Canonical binary: package `editor/neo-ppt/assets/pptd_wasm_bg-DPPWdROu.wasm` (skill install copies it into `scripts/local-export/pptd_wasm_bg.wasm`). Requires **Node.js 18+** only.
   - **Image QA / visual review**: maintainer-only check using the bundled editor runtime.
   - **Manual edit / preview**: Desktop opens the bundled local editor in an application window.
   - Image QA is a maintainer-only release check and may use the bundled browser/runtime; it is never an employee prerequisite.
   - Local PNG/JPEG/GIF/SVG files inside the PPTD project are resolved by the local exporter / injected as data URLs for the editor host.
   - Do not claim PowerPoint/WPS/Keynote playback compatibility solely because ZIP validation succeeds.
8. After export, verify that the output exists and report the generated path. Confirm that every slide has exactly one root-level fade transition in valid CT_Slide order (`cSld`, optional `clrMapOvr`, `transition`, optional `timing/extLst`) and that the PPTX ZIP passes integrity checks. A byte-string search for `<p:fade>` is insufficient because Office ignores transitions nested inside `cSld`. For higher-risk decks, additionally inspect font parts and representative rendered/opened pages as appropriate.
9. When the employee wants to continue editing, return the project artifact to the Desktop result surface. The host opens the bundled editor with the project already mounted and keeps edits inside the task workspace.
10. After completing a presentation, show the editable project, PPTX, previews, and actions for open, reveal, re-export, and continue modifying. Do not expose implementation names or shell commands.
11. Element animations (`page.animations` in PPTD — entrance / emphasis / exit / motion-path; see `reference/pptd.md` §6): use them only when the user explicitly requests animations, or when the deck is clearly intended for live presentation / slideshow playback and animation provides a clear benefit for staged disclosure, process demonstration, causal explanation, pacing, visual impact, or brand storytelling. By default, do not add element animations to reading-oriented, self-study, print, or primarily send-and-browse decks. Prefer 1–3 animation groups per page and simple effects such as fade, fly, and zoom. This is separate from the default PPTX slide-level fade page transition written by `export_pptx.py`.
12. Speaker notes (`notes` on each `.page`): use them only when the user explicitly requests them; otherwise, do not add them.
13. Parallel tool calls: during PPT production, make tool calls in parallel whenever possible; in each round, write multiple page files in parallel to reduce the number of steps.
