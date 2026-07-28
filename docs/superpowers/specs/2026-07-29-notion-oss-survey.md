# Notion UI/UX Open-Source Survey (2026-07-29)

Licenses verified against the GitHub repos. Perspective: closed-source commercial app,
non-destructive .md round-trip is a core product value. Local shallow clones of the
permissive repos live in `../references/` (outside this repo).

## Verdicts

**No code copy (study only):** AppFlowy (AGPL), SiYuan (AGPL), Logseq (AGPL),
Docmost (AGPL), Trilium (AGPL), Notesnook (GPL), Zettlr (GPL), Outline (BUSL-1.1),
Anytype (source-available, commercial-restricted), Huly (EPL), Tiptap's PAID
Notion template (never copy).

**Copy-code sources (permissive):**

| Source | License | What we lift |
|---|---|---|
| Plate (udecode/plate, 16k★) | MIT | #1 source. shadcn-style copy-in React 19 + Tailwind components: slash menu, ⋮⋮ drag handle + hover ＋ button, block selection, toggle, callout, table UI. Free registry only — the paid "Potion" template is off-limits. |
| SilverBullet (5.7k★) | MIT | Architecture twin (CM6 + plain .md). CM6 decoration/widget/slash implementation code. |
| Lexical playground (24k★) | MIT | DraggableBlockPlugin geometry (hit-testing, drop indicator) for the ⋮⋮ handle. |
| Colanode (5k★) | Apache-2.0 | Database view UI (table/kanban/calendar). |
| suitenumerique/docs (17k★) | MIT | Production Notion-grade app chrome (page tree, share/export flows) around a block editor. |
| Yoopta-Editor (3k★) | MIT | Secondary quarry: complete Notion plugin kit in React. |
| MarkText/Muya (59k★) | MIT | Aging but permissive WYSIWYG-on-md patterns. |
| outline/rich-markdown-editor (archived) | BSD-3 | Liftable PM markdown editor w/ slash menu (dated). |
| AFFiNE frontend (71k★) | MIT (repo mixed — verify per dir; backend excluded) | Selective UI reference. |
| BlockNote core | MPL-2.0 (file-level copyleft) | Usable commercially, but see decision below. |

## The BlockNote decision (honest)

BlockNote is the best out-of-box Notion replica, but its canonical format is block
JSON and its markdown API is literally `blocksToMarkdownLossy()` (nesting flattened,
styles dropped). Every open→edit→save would rewrite user files through a lossy
normalizer — a direct violation of the "your files, untouched" product value.
Same objection: Yoopta/Editor.js/Lexical-as-storage. Milkdown (MIT) is the only
markdown-native block editor, but still normalizes syntax on save and would replace
CM6 wholesale.

**Decision: keep CM6 as the source of truth; build the Notion skin on it**
(SilverBullet/Obsidian live-preview architecture — the path we're already on).

## Adoption plan

1. **Notion chrome on CM6**: SilverBullet CM6 patterns + Plate components; ⋮⋮/＋
   hover handle using Lexical's drag geometry mapped to line-range moves in the
   .md buffer. Files stay byte-stable except lines the user edits.
2. **Block widgets in CM6**: interactive callouts/toggles/tables as CM6 widgets;
   database views over frontmatter (lift view UI from Colanode/Plate).
3. **Optional block mode later**: Milkdown Crepe (MIT, markdown-native) opt-in per
   document with a visible "may reformat markdown syntax" contract. Never lossy
   JSON as storage.

Legal notes: preserve MIT/Apache/BSD attributions in the Acknowledgements screen;
MPL files (if any adopted) stay MPL and must be published; zero AGPL/GPL/BUSL code.
