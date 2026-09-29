---
name: daily-briefing
description: "Write a morning briefing into the vault: the day's priorities, urgent mail, markets, world affairs. Scheduled or on demand."
version: 1.0.0
author: Daat
license: MIT
platforms: [linux, macos, windows]
prerequisites:
  commands: []
metadata:
  hermes:
    tags: [Briefing, Daily, Secretary, Vault, News]
---

# Daily briefing

Assemble one briefing, write it into today's daily note, and answer with a short
digest. Run on a schedule, or when the user asks for it.

This runs unattended. **Never ask a question** — decide, or say what you could
not determine and why.

## What this is for

A secretary's morning is not a news feed. It is: what matters to *this person*
today, what is on fire, and what they should know before someone mentions it to
them. Everything below serves that, and anything that does not serve it is
padding.

## Order of work

Do these in order. Later sections depend on what earlier ones establish.

### 1. Read the vault before reading the world

Start with the user's own notes, because the briefing is *for* them and the
vault is what makes it theirs rather than generic:

- today's daily note, if one exists, and the last few before it
- any note the user keeps for context, preferences or standing instructions
  (`vault_search` for one; do not assume a filename)
- notes touched in the last few days — that is what they are actually working on

From this, decide the day's focus and **three concrete next actions**. Take them
from what is written down. **Never invent a deadline, a meeting, or a task.** If
the vault says nothing about today, say so plainly; an honest short briefing
beats an invented full one.

### 2. Urgent mail only

Read-only, always. **Do not send, reply, draft, move, delete, flag or mark read.**

Skip promotions, newsletters, receipts and notifications. What survives is mail
that needs a decision or an answer from the user. Usually that is one or two
messages, often none — "no urgent mail" is a good outcome, not a failed section.

Never copy an authentication code, password, account number, balance or token
into the note. A briefing is a file that syncs; treat it as public.

If mail is not configured, skip the section and say which part is missing. Do
not treat that as a failure of the whole briefing.

### 3. Markets, only if the user follows them

Skip entirely unless the vault shows they care.

Report what the session actually did: the major indices, volatility, rates, and
where the moves were concentrated. **Give the session date.** Stale prices
presented as current are worse than no prices.

**Never issue trade instructions and never promise a return.** If asked for
candidates, name one only when you have verified it from a primary source and
an independent one, and give the price, the reason, what would confirm it, what
would invalidate it, and the risk. Otherwise say there are none today. Any
market section ends with a line saying it is information, not financial advice.

### 4. World affairs — five to seven items

Diversity of *publisher and stance*, not artificial balance:

- **at least four different publishers**, normally at most one item each
- mix reporting, market/business analysis, a perspective from outside the
  user's own country, and one piece of deeper institutional analysis
- do not let one publisher dominate because it is easiest to fetch

For each item: publisher, date, direct link, the headline, and — this is the
part that matters — **whether it is reporting, explanation, analysis or
opinion.** Say why it matters to this user. Where two sources frame the same
event differently, say so; that difference is often the most useful thing in the
briefing.

**A headline and a snippet are not enough to assert a fact.** Open the piece. If
you could not, quote it as a headline and label it as unread.

### 5. Anything the user tracks

If the vault shows a standing interest — their industry, a technology, a
competitor, a course — close with three to five items on it, held to the same
sourcing standard.

## Writing it into the vault

Replace **only** your own section of today's daily note. Everything the user
wrote stays. Never append a second copy — find the existing section and replace
it, or create it once if it is absent.

Keep the section order stable day to day. Someone reading their fifth briefing
should know where to look without reading the headings:

```
## Morning briefing
### At a glance
### Today's focus
### Urgent mail
### Markets
### World
### Watching
```

Link to vault notes with `[[wikilinks]]` wherever the briefing touches
something the user already keeps a note on. That is what turns a briefing into
memory instead of a daily throwaway.

## The reply

Short. The note holds the detail; the reply is what they read on a phone before
getting up: today's focus, anything urgent, the two or three things they would
be embarrassed not to know, and the path to the full note.

## When something fails

Continue. Name the source that failed and what it cost — "markets unavailable,
everything else current" — then deliver the rest.

**Never present old data as today's, and never fill a gap by guessing.** A
briefing that quietly invents a number is worse than no briefing, because it is
believed.

## Language

Write in the language the user writes in. If their notes are Korean, the
briefing is Korean — including the summaries of English sources, with the
original headline kept alongside so they can find it.
