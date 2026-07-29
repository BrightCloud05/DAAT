# Notion x Obsidian Strengths Research (2026-07-28)

Research workflow: 3 parallel web-research agents + synthesis. Source of the v2 product pivot.

## Synthesis

# Daat Product Synthesis: Feature Matrix, v1 Cut, Agent UX, Positioning

## 1. Merged Feature Matrix

Legend: cost assumes existing CM6 editor + wikilinks + FTS/SQLite index + hermes-agent runtime. Phase v1 = next 2–4 weeks on top of M2 editor work.

| Feature | From | User value | Cost (our stack) | Phase |
|---|---|---|---|---|
| Slash-command block menu | Notion | HIGH (the "Notion feel" trigger) | LOW (CM6 autocomplete source) | **v1** |
| Callouts (`> [!note]` syntax, styled) | Both (Obsidian syntax, Notion look) | HIGH | LOW (line decoration over blockquote) | **v1** |
| Toggle blocks (fold w/ chevron UI) | Notion | MED-HIGH | LOW-MED (CM6 folding + gutter widget) | **v1** |
| Properties panel from frontmatter (Notion-style, top of page) | Both | HIGH (bridge between md files and "database" mental model) | MED (YAML parse ↔ panel sync) | **v1** |
| Daily note + note templates | Obsidian | HIGH (habit-forming entry point) | LOW | **v1** |
| Page icons + cover images | Notion | MED-HIGH (aesthetics drive adoption) | LOW | **v1** |
| Backlinks panel | Obsidian | HIGH (core "second brain" value; wikilinks already exist) | LOW-MED (query existing link index) | **v1** |
| Hover gutter: "+" insert button + "⋮⋮" block menu (turn-into/duplicate/delete) | Notion | HIGH (visual signature of Notion) | LOW-MED (menu only, no drag) | **v1** |
| Table view over frontmatter ("Bases"-style, editable cells) | Notion (the lock-in feature) | **HIGH — the #1 thing that keeps people on Notion** | MED (SQLite already indexes; UI is the work) | **v1.5** (read-only saved-query table is a v1 stretch goal) |
| Drag-and-drop block reordering | Notion | MED-HIGH | HIGH in CM6 (block drag in a text buffer is fiddly) | v1.5 |
| Kanban + gallery views on same data | Notion | HIGH | MED | v1.5 |
| Inline AI in editor (Cmd-K / space-bar ghost prompt) | Notion AI | HIGH | MED (hermes-agent already exists; UI wiring) | **v1** (see §3) |
| Quick switcher / command palette (Cmd-P) | Obsidian | HIGH | LOW (FTS exists) | **v1** if not already shipped |
| Embeds (images, PDF, ~web) | Notion | MED | MED | v1.5 |
| Calendar/timeline views | Notion | MED | MED-HIGH | v2 |
| Relations + rollups + formulas | Notion | MED (power users only; export-fidelity nightmare) | HIGH | v2 (relations via wikilinks-in-properties first) |
| Template gallery / community sharing | Notion | MED | MED (needs hosting) | v2 |
| Publish to web | Notion/Obsidian Publish | MED | MED-HIGH | v2 (also a revenue line) |
| Graph view | Obsidian | LOW (honeymoon eye-candy per research) | MED | v2 or skip |
| Unlinked mentions | Obsidian | LOW-MED | MED | v2 |
| Real-time multi-user collaboration | Notion | HIGH for teams, irrelevant to wedge | VERY HIGH (CRDT over local md) | **skip** (single-player is the deal, per Obsidian research) |
| Mobile app | Both (both are hated on mobile) | HIGH eventually | VERY HIGH | v2+ (don't fake it) |
| Plugin API | Obsidian | MED | HIGH (and causes overwhelm) | skip for now — the agent IS the extensibility story |
| E2E sync service | Obsidian Sync | MED | HIGH | v2 (revenue line; files work with iCloud/Git meanwhile) |

## 2. The v1 Cut (decisive: 8 items)

Ordered by feel-per-cost. Together these make a markdown vault *feel* like Notion in ~2–4 weeks:

1. **Slash-command menu** — the single highest feel-to-cost ratio; it's how people *recognize* Notion.
2. **Hover gutter with + and ⋮⋮ block menu** — Notion's second visual signature. Ship the menu (turn into, duplicate, delete, move up/down); defer actual drag to v1.5. Nobody misses drag on day one; everyone notices the handles.
3. **Callouts** using Obsidian's `> [!note]` syntax rendered Notion-pretty — free compatibility with the Obsidian ecosystem, zero format lock-in.
4. **Toggle blocks** via fold UI on headings/lists.
5. **Properties panel from frontmatter** — Notion-style property rows at the top of the page, round-tripping to YAML. This is the load-bearing feature: it's what makes v1.5's table/kanban views possible and teaches users their files are structured data.
6. **Daily note + templates** (Cmd-D, template picker on new note) — Obsidian's proven habit loop, trivially cheap.
7. **Page icons + covers** — cheap, and research says aesthetics are literally why the student/personal segment adopts.
8. **Backlinks panel** — the index already exists; this converts the Obsidian-curious.

Explicitly **not** in v1: drag reorder, kanban, relations, graph view, collaboration, publish. Stretch goal only: a read-only "all notes as table" view filtered by folder/tag, since SQLite makes it nearly free — it previews the v1.5 database story.

## 3. Agent UX Stance: de-emphasize chat, foreground actions

Research basis: Notion AI's most-criticized surface is its Q&A/chat ("limited model wrapper"); the persistent copilot pane is a commodity every competitor has; meanwhile the community duct-taping Claude Code into Obsidian shows demand is for *agency*, not chat. And Obsidian research warns that visible complexity (panes, config) is the #1 adoption killer.

**Recommendation — three surfaces, no default chat pane:**

1. **Inline AI in the editor (primary surface).** Cmd-K / space-on-empty-line, Notion-AI style: continue writing, summarize, translate, fix, "ask about this note." This is where 80% of daily AI use happens and it keeps the app feeling like a note app. Ship in v1.
2. **Summonable agent overlay (the superpower surface).** A global-hotkey command-palette-style panel (Cmd-J) — appears over the app, takes a task, then *collapses into a background activity strip*. Not a docked sidebar. The chat transcript is reachable but the default presentation is "task in, progress out."
3. **Action ledger, not chat bubbles.** When the agent uses terminal/files/browser, render a compact step ledger (ran `x`, edited `y`, opened `z`) with expand-for-detail and approval gates for destructive/off-vault actions. This is both the trust mechanism and the *marketing* mechanism — seeing "ran a terminal command" is what makes the differentiator visceral.

**Discoverability of computer control** (so de-emphasis doesn't hide the moat): (a) first-run showcase tasks — "import my Apple Notes," "organize this folder into my vault," "clip the page open in my browser"; (b) `/agent` inside the slash menu so the block menu itself advertises it; (c) suggested actions on note context ("this note lists 5 files — want me to fetch them?"). The agent should feel like a capability of the document, not an app-within-an-app.

## 4. Positioning + Pricing Line

**Positioning sentence:**
> **Daat is the second Notion, built on files you own: Notion's beloved editing on plain local markdown, with an AI agent that can actually use your Mac — the one thing Notion AI can never do.**

(One-liner variant: "Notion's soul, Obsidian's bones, Claude Code's hands.")

**Free / paid line** — given: Obsidian core is free, Copilot is free-with-BYOK ($12–15 for built-in), Notion AI costs $20+/user, Reflect $10, Capacities Pro $9.99:

- **Free forever:** the entire note app — editor, blocks, properties, views (including v1.5 database views), backlinks, search, daily notes — **plus inline BYOK AI scoped to the vault** (write, summarize, Q&A). Rationale: you cannot charge for what Obsidian+Copilot gives away, and free vault-scoped AI is the acquisition hook against Notion's $20 paywall resentment.
- **Daat Pro — $10/mo or $96/yr, BYOK:** the computer-control agent (terminal, filesystem beyond the vault, browser), scheduled/background agents, multi-step task runs, agent memory. You're selling software capability, not tokens, so BYOK carries no margin risk and undercuts Notion Business by half while pricing at the Reflect/Capacities anchor. Add a **one-time license option (~$149/major version)** to court the anti-subscription Obsidian demographic — it's that community's stated values (indie, no VC, no rent).
- **Later revenue lines (v2):** E2E sync and Publish — the proven Obsidian monetization that doesn't compromise "your files, free."

The paywall sits exactly on the moat: everything a competitor also offers is free; the thing nobody ships — an agent with hands — is what you pay for.

## Appendix A — Notion strengths/complaints (raw)

STRENGTHS (ranked by frequency across sources)

1. All-in-one consolidation — replaces 3-6 separate apps
   - Delivered by: pages that can contain anything (notes + tasks + docs + databases on one page), wiki page-tree hierarchy, embeds of external content, and adjacent products (Notion Calendar, Notion Mail) forming one ecosystem
   - Frequency: HIGH — the single most-cited reason in every source (HN, G2/Capterra, user reviews, blogs). Canonical quote pattern: "I stopped switching between different apps"

2. Databases with multiple views — "the real superpower"
   - Delivered by: inline/full-page databases; the same data rendered as table, kanban, calendar, gallery, timeline; per-view filters and sorts; property types (select, status, date, person, formula); relations + rollups linking databases; formulas doing logic across properties. Users cite "create a Kanban in seconds, turn it into a table, share it with a client"
   - Frequency: HIGH — power users say "you aren't really using Notion unless you're using databases"; it is the feature Obsidian users missed until Bases shipped

3. Flexibility / build-your-own-tool customization
   - Delivered by: the block model (everything is a block: text, toggle, page, database, embed), drag-and-drop rearranging, slash-command insertion, no imposed structure — users build CRMs, habit trackers, editorial calendars, student dashboards nobody designed for them
   - Frequency: HIGH — "no-code, drag-and-drop block system feels creative"; customization is the #2 theme on Capterra/G2

4. Clean, aesthetic UI
   - Delivered by: minimal document-like canvas, cover images/Unsplash integration, page icons/emoji, dark mode, callouts, toggle lists. Aesthetics drive adoption (and the template economy)
   - Frequency: MED-HIGH — "nice looking," pleasant enough that people WANT to open it; also the hook for the student/personal-productivity segment

5. Collaboration and sharing
   - Delivered by: real-time co-editing, comments and @mentions, granular page permissions, share-to-web/publish (Notion Sites), team wikis
   - Frequency: MED-HIGH — dominant reason in team/startup contexts (HN threads); "share it in seconds with your client/team is priceless"

6. Template + community ecosystem
   - Delivered by: template gallery, one-click duplicate of any shared page, thousands of free/paid templates, huge YouTube tutorial ecosystem — lowers the blank-canvas barrier
   - Frequency: MED — cited as the reason non-experts get value ("databases easy even for people who aren't database experts")

7. Cross-platform + generous free tier
   - Delivered by: web/desktop/mobile sync, free personal plan with unlimited blocks; "access anywhere" repeatedly cited
   - Frequency: MED

8. API / integrations / AI
   - Delivered by: public API, Notion AI (writing, workspace Q&A), AI-assisted setup of dashboards
   - Frequency: LOW-MED — appreciated by developers; AI is polarizing (see complaints)

COMPLAINTS (the competitor openings, ranked)

1. Performance/slowness — HIGH. Slow page loads, typing lag, sluggishness with large databases, Electron app criticized. ~15+ mentions in a single HN thread; "most reviewers report performance issues" on Capterra. The #1 opening.
2. Weak offline mode — HIGH. Historically internet-required; drove defections to Obsidian ("local-first"). Notion shipped offline mode mid-2025 but reviewers still call it unreliable/limited.
3. Complexity / setup tax / blank-canvas overwhelm — HIGH. "Spending half my energy fighting Notion"; steep learning curve; cognitive overhead of infinite flexibility; teams struggle with undocumented conventions; "pseudo-productivity" — organizing instead of producing ("90% of my pages are just really well organised").
4. Jack of all trades, master of none — MED-HIGH. Loses to specialized tools: no dependent tasks/real Gantt, task UX worse than Todoist, hits limits then requires manual maintenance.
5. Poor mobile app — MED-HIGH. Laggy, clunky, feature-limited vs desktop; kills journaling/on-the-go use cases.
6. Data lock-in / export fidelity — MED. Closed source; export loses relations/rollups (comes out as plain text); no E2E encryption, employees can access data; no self-hosting.
7. Bad search — MED. "HORRIBLE unless you know exact titles"; navigation of large workspaces is poor; restructuring nested pages "a nightmare."
8. Pricing/AI resentment — MED and rising (2025-2026). May 2025 move locked Notion AI behind Business plan ($20/user/mo); Reddit reaction "cash grab"; AI itself seen as a limited model wrapper; Q&A feature most criticized.
9. Shallow integrations — LOW-MED. No true Google Workspace integration, native email connections lacking, existing integrations "superficial."

STRATEGIC READ: Users love Notion for consolidation + databases-with-views + block flexibility, and tolerate it despite speed, offline, mobile, and complexity. The proven wedge (Obsidian, Linear, Anytype, Capacities all use it): be fast, local-first/offline, own-your-data, and either radically simpler or deeper in one vertical — while matching multi-view databases, since that is the feature that keeps people locked to Notion.

Sources: [HN: Notion for everyone](https://news.ycombinator.com/item?id=23236786) | [HN: I love using Notion, but...](https://news.ycombinator.com/item?id=23237380) | [HN: How I use Notion to manage everything](https://news.ycombinator.com/item?id=34840769) | [XDA: I still use Notion](https://www.xda-developers.com/why-i-still-use-notion-when-it-feels-like-everyone-switching/) | [HowToGeek: Notion's real superpower is linked databases](https://www.howtogeek.com/i-finally-understand-notion-databases/) | [Substack: Why I'm quitting Notion](https://nicholasng.substack.com/p/quitting-notion) | [Hack'celeration: 15 real user reviews](https://hackceleration.com/labs/review/notion) | [Capterra Notion reviews](https://www.capterra.com/p/186596/Notion/reviews/) | [G2 Notion reviews](https://www.g2.com/products/notion/reviews) | [XDA: Obsidian Bases cancelled my Notion plan](https://www.xda-developers.com/obsidian-bases-turned-notes-into-database-and-cancelled-notion-plan/) | [Notion AI Reddit review roundup](https://www.aitooldiscovery.com/guides/notion-ai-reddit)

## Appendix B — Obsidian strengths/complaints (raw)

All research complete — 11 distinct sources read. Here is the structured synthesis.

# Why People Use and Love Obsidian (user-voiced, 2024–2026)

**Sources read (11):** HN "How I use Obsidian" thread (id 41034567, 2024); HN "Why I Like Obsidian" thread (id 39027154, 2024); HN Obsidian thread (id 45752923, 2025); HN "I love Obsidian, but…" thread (id 39765079, 2024); r/ObsidianMD "What made you move to Obsidian?" (47-comment thread 15ilnk3, via pullpush archive); r/ObsidianMD rant/complaint posts aggregate (9 posts incl. 63-upvote rendering rant 1fz7xbi, tables rant 1kc2emc, Android speed rant 1i7by8b); Robert Talbert "How and why I use Obsidian" (intentionalacademia.com, 2025); "How I Use Obsidian (and Why)" (librarian.aedileworks.com, 2025); Toxigon long-term review (2024–25); "Obsidian is too complicated" (productivematters.substack.com); "Why did I switch from Notion to Obsidian" (dev.to/dlion). Note: reddit.com blocks direct crawling; Reddit data obtained via the pullpush.io archive API.

## STRENGTHS — ranked by frequency across sources

**1. Local-first plain-Markdown files you own / no lock-in (in all 11 sources; ~12 mentions in the single Reddit thread alone — the runaway #1)**
- Product mechanism: the "vault" is literally a folder of .md files on disk; the app is "a wrapper around a folder of Markdown files." Readable by any editor, forever, even if Obsidian dies. Quote: "even if something happens to Obsidian, the notes still exist."
- Importance: foundational — it's the trust/insurance argument that converts Evernote/Notion refugees ("if they go bust… you lose access"). Almost every "why I use" post opens with this.

**2. Backlinks / networked notes / graph (9 of 11 sources; ~7 mentions in Reddit thread)**
- Product mechanism: [[wikilinks]], backlinks pane, unlinked mentions, graph view.
- Importance: the core differentiator vs. a plain folder of files — "THAT'S how my brain works"; "suddenly I could see how my thoughts connected." Nuance: daily value is in backlinks; graph view is often honeymoon eye-candy.

**3. Plugin ecosystem / extensibility (9 of 11; ~6 Reddit mentions)**
- Product mechanism: 1,300–2,000+ community plugins (Dataview, Tasks, Kanban, Excalidraw, Templater, Readwise, Git), themes, CSS snippets, open plugin API. HN: "they have made extensibility a top priority."
- Importance: lets one app become a journal, PM tool, Zettelkasten, D&D tracker. Double-edged — also the #2 complaint (see below).

**4. Privacy / offline / no account (8 of 11; ~6 offline mentions on Reddit)**
- Product mechanism: everything local, works fully offline, no sign-up, optional E2E-encrypted sync. Notion's lack of offline was the single decisive switch trigger for several authors.
- Importance: high for travelers, professionals with sensitive notes, and the privacy-minded.

**5. Speed (6 of 11; ~5 Reddit mentions)**
- Product mechanism: local files = no network round-trips; fast startup and search on desktop ("fast for an Electron app").
- Importance: a daily-feel driver — "It is fast. It is reliable"; "speeeeeeeeed" — explicitly contrasted with Notion's loading spinners. (Caveat: desktop only; mobile is a complaint.)

**6. Free + sustainable indie business model (5 of 11; ~4 Reddit price mentions)**
- Product mechanism: free core app for personal use; revenue from optional Sync/Publish; bootstrapped, no VC, no ads. Users cite fleeing Evernote price hikes; one blogger chose it partly on values ("supported by subscribers, not venture capital").
- Importance: moderate but reinforces #1 (company can't be acquired/enshittified as easily).

**7. Flexibility / no imposed structure (5 of 11)**
- Product mechanism: folders, tags, links, properties all optional — "write markdown, stick it in a folder and do nothing." "Bends to fit how you think."
- Importance: loved by tinkerers; the same freedom becomes decision paralysis for newcomers.

**8. Daily notes / low-friction capture + journaling (4 of 11)**
- Product mechanism: core Daily Notes + templates + Periodic Notes plugin; open app, today's note is one keystroke away.
- Importance: the habit-forming entry point; repeatedly praised as the simplest durable workflow.

**9. Sync your way (4 of 11)**
- Product mechanism: because notes are files, any sync works — iCloud, Syncthing, Git ("auto-backup every 15 min to GitHub"), or paid E2E Obsidian Sync.
- Importance: valued as freedom of choice, but DIY sync is also a top complaint source.

**10. Search (2 of 11)** — "the best search among similar tools"; lets people skip elaborate organization. Modest but real.

**11. Canvas (1–2 of 11)** — mentioned only in passing (mind-maps/flowcharts). Rarely a stated reason for adoption; low importance in the user-voiced record.

## TOP COMPLAINTS — ranked by frequency

1. **Learning curve / "simplicity problem"** — "a stark, Markdown-based wilderness" with "no obvious start-here button"; must learn Markdown; base app feels bare ("Where's everything else?"); useful setups require configuration work.
2. **Plugin overwhelm & fiddling trap** — selection paralysis across 1,300+ plugins; abandoned/unmaintained plugins; unsandboxed third-party code as a security worry; "productivity porn"/CRIMP — a Redditor described a 3-month configuration rabbit hole with no output; one HN power user runs 65 plugins to fill product gaps. Plugin-specific syntax (Dataview queries) quietly re-creates lock-in inside the "no lock-in" app.
3. **Mobile is second-class** — slow cold starts ("loads in 3.5s… renders Obsidian useless on phone"), iOS+iCloud hangs on large vaults, plugins unreliable on mobile, clunky editing.
4. **Sync friction** — iCloud unreliability/conflicts/offloaded-empty-notes is a recurring Reddit rant genre; paid Sync costs extra and still occasionally conflicts; one HN user reported sync "scrambled" notes.
5. **No collaboration** — no real-time multi-user editing/sharing; universally conceded as "not the tool" vs. Notion/Google Docs; single-player by design.
6. **No real tables/databases** — Markdown tables "very unreliable… extremely easy to break"; no native database views (Dataview is a plugin workaround). (Product response: the core "Bases" feature shipped in 2025 to address this — post-dates most complaint threads read.)
7. **Editing/rendering quirks** — the highest-scored Reddit rant found (63 upvotes) targets live-preview rendering inconsistency ("requires too much tinkering… feels clunky visually"); also numbered-list resets, clunky image handling vs. OneNote.
8. **Closed-source core** — recurring HN objection; free but not FOSS; commercial license required for work use bothers some.

**Key pattern:** the strengths and complaints are the same coin — file-over-app ownership causes the sync/mobile/collaboration gaps; extensibility causes the overwhelm. Users who love it accept "single-player, local, DIY" as the deal; complaints cluster among people wanting Notion-like out-of-box completeness.

Sources: [HN 41034567](https://news.ycombinator.com/item?id=41034567), [HN 39027154](https://news.ycombinator.com/item?id=39027154), [HN 45752923](https://news.ycombinator.com/item?id=45752923), [HN 39765079](https://news.ycombinator.com/item?id=39765079), [r/ObsidianMD thread 15ilnk3 via pullpush](https://api.pullpush.io/reddit/search/comment/?link_id=t3_15ilnk3), [r/ObsidianMD rant posts via pullpush](https://api.pullpush.io/reddit/search/submission/?subreddit=ObsidianMD&q=rant), [intentionalacademia.com](https://www.intentionalacademia.com/p/how-and-why-i-use-obsidian), [librarian.aedileworks.com](https://librarian.aedileworks.com/2025/03/31/how-i-use-obsidian-and-why/), [toxigon.com](https://toxigon.com/obsidian-review-2024), [productivematters.substack.com](https://productivematters.substack.com/p/obsidian-is-too-complicated), [dev.to/dlion](https://dev.to/dlion/why-did-i-switch-from-notion-to-obsidian-3l44)

## Appendix C — Competitive landscape (raw)

# Competitive Landscape: AI Note Apps (2025–2026)

## 1. Per-App Analysis

### Notion AI (Notion 3.0 Agents)
- **Positioning:** Cloud workspace-as-OS. Notion 3.0 shipped Agents (Sep 2025), then Custom Agents (autonomous, scheduled/triggered), AI Meeting Notes, Enterprise Search, and "Workers" (Apr 2026) — sandboxed JS/Python execution inside Notion's infra.
- **Pricing:** Free/Plus get only a one-time ~20-response AI trial. Full AI requires **Business at $20/user/mo annual (~$24 monthly)** — the standalone $10 AI add-on was eliminated in 2025. As of May 2026, Custom Agents move to metered **Notion Credits ($10 per 1,000/mo, no rollover)** on top of seats. No BYOK, no model choice.
- **Can it touch files outside Notion / control your computer? NO — this is the critical finding.** Notion AI is a closed system scoped to Notion pages/databases plus sanctioned connectors (Slack, Gmail, Drive, GitHub, HubSpot). It can read *uploaded* files (PDF/CSV/XLSX/DOCX) and generate downloadable files, but agents cannot access your local filesystem, shell, terminal, or other desktop apps. Even Workers explicitly "cannot access filesystems," have a 10s/128MB cap, and can't persist state; the local Notion MCP server (which had more tools) is being sunset in favor of the hosted, page-level MCP. Community hacks (e.g. `notion-local-ops-mcp`) exist precisely because the official product can't do this.
- **The gap:** Your data lives in their cloud in their format, and the agent stops at Notion's walls.

### Obsidian + Copilot plugin
- **Positioning:** "AI second brain" chat/agent layer inside a local-markdown vault.
- **Pricing:** **Free with BYOK** (any API key, no signup); **Plus $14.99/mo or ~$11.67/mo annual ($139.99/yr)** for built-in models, agents, web search, PDF/EPUB; **Self-Host/Supporter one-time $349.99**; legacy Believer grandfathered.
- **Gap:** Agent is sandboxed to the vault + web; no terminal, no cross-app control. And Obsidian's editing UX remains markdown-file-centric — Bases (core plugin since v1.9, mid-2025) added Notion-style table/card views over frontmatter, but reviewers still frame it as "Dataview made approachable," needing community plugins (GoodBases, Notion Bases) to imitate Notion's inline-editing polish.

### Obsidian + Smart Connections
- **Positioning:** Local-first semantic search/related-notes ("link-building copilot"). Local embeddings (BGE-micro), zero setup, no API key; notes never leave the machine.
- **Pricing:** **Core free & source-available; Pro $30/mo or $299/yr** (inline connections, advanced ranking, large-vault index, chat workspace, ChatGPT vault actions).
- **Gap:** Retrieval, not agency — it surfaces connections; it doesn't *do* anything, and Pro pricing is steep for what is essentially search.

### Reflect
- **Positioning:** Fast, elegant, E2E-encrypted networked notes with a "thought partner" AI (GPT-4 + Whisper voice transcription).
- **Pricing:** **Single plan, $10/mo or $100/yr; no free tier** (14-day trial only). AI bundled; also accepts your own OpenAI key for some features.
- **Gap:** Deliberately minimal — no databases/tables (nowhere near Notion-grade structure), cloud-synced not local files, and AI is a sidekick, not an agent.

### Mem
- **Positioning:** "Self-organizing" AI-first notes; Mem 2.0 (early 2026) pivoted to an AI thought partner/meeting-capture tool for knowledge workers — no manual folders/tags.
- **Pricing:** **~$14.99/mo** subscription; free tier minimal/trial-ish. No BYOK.
- **Gap:** Full cloud lock-in, opaque organization you can't inspect, weak structured editing, and a history of pivots that undermines trust for long-horizon note storage.

### Capacities
- **Positioning:** Object-based PKM ("studio for your mind") — typed objects instead of folders, a middle ground between Notion structure and networked notes.
- **Pricing:** **Free forever plan** (unlimited objects, 5GB media); **Pro $9.99/mo** unlocks the AI assistant (OpenAI-powered chat, auto-fill properties, auto-tagging, on a *daily budget*); Believer ~$12.49/mo.
- **Gap:** Cloud-based despite privacy positioning (no local files/markdown source of truth), AI is a budgeted assistant not an agent, no BYOK.

### Anytype
- **Positioning:** Local-first, P2P-encrypted, open-source "Notion alternative you own" with Notion-like types/relations.
- **Pricing:** **Generous free tier** (local-first, 1GB sync); paid ~**$9–19/mo** (Builder ~$99/yr) mostly buys sync storage/shared-space capacity. AI features (write/summarize/organize) arriving cautiously.
- **Gap:** Data is in a local *encrypted database*, not plain markdown (export only) — and AI is shallow; no agent, no BYOK depth, and the custom storage format ironically weakens the "you own your files" pitch for AI tooling that wants to read plain files.

### Craft
- **Positioning:** Apple-polished documents; 2026 version added a tiered AI assistant (Core/Fast/Max) and — notably — **native MCP connections to Claude, ChatGPT, and Cursor**, positioning docs as context for external AI tools.
- **Pricing:** **Free (10 docs, 15 AI credits); Plus $8/mo** (~$4.80 annual); Family $15; Team $50.
- **Gap:** Proprietary format + cloud sync (not user-owned markdown), AI credits metering, weak databases; MCP makes Craft *readable by* agents rather than making Craft *agentic*.

### Local-first Notion clones: AFFiNE / AppFlowy
- **AFFiNE:** Open-source local-first docs+whiteboard+database; **Free forever; Pro ~$6.75/mo; Self-hosted Team $10/seat**; AI integrated with MCP support. ([affine.pro/pricing](https://affine.pro/pricing))
- **AppFlowy:** The most direct open-source Notion clone; **Free plan; Pro $10/user/mo; local AI via Ollama is FREE** ([announcement](https://appflowy.com/blog/appflowy_local_ai_ollama)), plus Vault Workspace ($6/user/mo, fully offline AI) and AI MAX ($8/user/mo, frontier models).
- **Gap (shared):** Both store data in internal databases (markdown import/export, not markdown-native), editing polish trails Notion, and AI = chat/completion — no computer control.

### Honorable mention: Reor
- Open-source (AGPL), free, local markdown + local models (Ollama/Transformers.js/LanceDB), Obsidian-like editor, auto-linking and Q&A. Proof the "private local AI notes" demand exists — but it's a thin editor with retrieval AI, no Notion-grade UX, no agent. ([github.com/reorproject/reor](https://github.com/reorproject/reor))

## 2. The Specific Assessment: does anything combine (a) local markdown you own + (b) Notion-grade editing UX + (c) an agent with real computer control?

**No shipping product combines all three. Every player has exactly two of the three at best:**

| Candidate | (a) Local markdown | (b) Notion-grade UX | (c) Real computer-control agent |
|---|---|---|---|
| Notion 3.0 Agents | ✗ (cloud, proprietary) | ✓ (the benchmark) | ✗ (explicitly cannot touch filesystem/other apps) |
| Obsidian + Copilot/Smart Connections | ✓ | ~ (Bases narrows but doesn't close the gap) | ✗ (vault-scoped) |
| Obsidian + Claude Code plugins (Claudian, Agent Client, Vault Agent Terminal) | ✓ | ✗ (it's a terminal embedded in an editor) | ✓ (file/bash/multi-step via Claude Code) |
| Reflect / Mem / Capacities / Craft | ✗ | ✗ / ~ | ✗ |
| Anytype / AFFiNE / AppFlowy | ~ (local but DB format) | ~ | ✗ |
| Claude Cowork / Claude Desktop (Anthropic, Jan 2026) | ✓ (works in your local folders) | ✗ (no note-taking UX at all) | ✓ (multi-step autonomous local file work, plugins) |

**The frontier is being approached from two directions, and the middle is empty:**
1. **Notes apps adding AI** (Notion, Craft, Capacities) keep the agent inside their sandbox — Notion's Workers "cannot access filesystems" is the category's ceiling stated outright.
2. **Agents adding file access** (Claude Code, Claude Cowork — launched Jan 12, 2026 for local-folder knowledge work, expanded to web/mobile July 2026) have real computer control over your markdown but zero editing/reading UX — no backlinks, no databases, no daily notes, no mobile capture.
3. **The community is duct-taping the two together** — Obsidian forum plugins embedding Claude Code/Codex in vaults (Claudian et al.) and Medium/blog workflows treating an Obsidian vault as an agent's working directory are the strongest demand signal: users are manually assembling exactly the product that doesn't exist.

**The open slot:** a local-markdown-native app with Notion-quality block editing and databases (what Obsidian Bases gestures at) whose built-in agent has Claude-Code-class capabilities — read/write any file, run terminal commands, drive a browser, act across apps — with BYOK pricing. Nobody ships it as one product as of mid-2026.

## Sources
- Notion: [Fazm — Notion AI Features 2026](https://fazm.ai/blog/notion-ai-features-2026), [Fazm — Notion AI Updates 2025-2026](https://fazm.ai/blog/notion-ai-updates-2025-2026), [Notion Help — Notion Agent](https://www.notion.com/help/notion-agent), [Notion Help — Custom Agents](https://www.notion.com/help/custom-agents), [StackOne — Notion MCP deep dive](https://www.stackone.com/blog/notion-mcp-deep-dive/), [notion-local-ops-mcp](https://github.com/catoncat/notion-local-ops-mcp), [eesel — Notion pricing](https://www.eesel.ai/blog/notion-pricing), [felloai — Notion AI pricing](https://felloai.com/notion-ai-pricing/)
- Obsidian ecosystem: [Copilot pricing](https://www.obsidiancopilot.com/en/pricing), [Smart Connections](https://smartconnections.app/smart-connections/), [Smart Connections Pro](https://smartconnections.app/pro-plugins/), [smart-connections GitHub](https://github.com/brianpetro/obsidian-smart-connections), [XDA — Obsidian Bases](https://www.xda-developers.com/obsidian-bases-turned-notes-into-database-and-cancelled-notion-plan/), [Practical PKM — Bases overview](https://practicalpkm.com/bases-plugin-overview/)
- Reflect: [costbench](https://costbench.com/software/note-taking/reflect/), [aichief review](https://aichief.com/ai-productivity-tools/reflect-ai/)
- Mem: [AIVario review](https://aivario.com/tools/mem-ai), [workgpt review](https://workgpt.com/en/app-reviews/mem-ai)
- Capacities: [costbench](https://costbench.com/software/note-taking/capacities/), [spotsaas pricing](https://www.spotsaas.com/product/capacities/pricing)
- Anytype: [aisotools pricing](https://aisotools.com/pricing/anytype), [toolradar pricing](https://toolradar.com/tools/anytype/pricing)
- Craft: [craft.do/pricing](https://www.craft.do/pricing), [websites2know review](https://websites2know.com/craft-do-review/), [aiproductivity pricing](https://aiproductivity.ai/pricing/craft/)
- Local-first clones: [AFFiNE pricing](https://affine.pro/pricing), [AppFlowy local AI + Ollama](https://appflowy.com/blog/appflowy_local_ai_ollama), [BestAlternative comparison](https://www.bestalternative.dev/en/blog/best-notion-alternatives-2026-affine-appflowy-anytype-comparison), [Reor GitHub](https://github.com/reorproject/reor)
- Agent side: [Obsidian forum — Vault Agent Terminal](https://forum.obsidian.md/t/new-plugin-obsidian-vault-agent-terminal-with-claude-code-codex/110024), [Claudian](https://github.com/YishenTu/claudian), [Obsidian forum — Agent Client](https://forum.obsidian.md/t/new-plugin-agent-client-bring-claude-code-codex-gemini-cli-inside-obsidian/108448), [Medium — Obsidian + multi-agent workflows](https://medium.com/@talha.asif.77/building-a-second-brain-for-ai-obsidian-multi-agent-workflows-639e52b1ac8e), [creati.ai — Anthropic Cowork launch](https://creati.ai/ai-news/2026-07-02/anthropic-debuts-cowork-a-claude-desktop-agent-that-can-work-inside-local-folders-for-non-techni/), [felloai — Claude Cowork guide](https://felloai.com/claude-cowork-guide/), [heranlab — desktop agents 2026](https://heranlab.com/blog/best-ai-desktop-agents-2026/)
