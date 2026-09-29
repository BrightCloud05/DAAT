/**
 * Where "archive" and "trash" actually go.
 *
 * IMAP has no archive verb — archiving is a move, and the destination folder is
 * named differently by every provider. Hard-coding "Archive" works on Fastmail,
 * fails on Gmail (which calls it `[Gmail]/All Mail`), and on an account whose
 * folders are in Korean or German matches nothing at all.
 *
 * TWO SOURCES, IN ORDER
 *
 * himalaya lets the user declare `folder.aliases.trash` in their own config,
 * and that is the authoritative answer: they wrote it, it is right, and it
 * already handles the account whose trash is `[Gmail]/휴지통`. So the caller
 * passes the alias first and only falls back to the names below when the
 * account has not declared one — which is common for `archive`, since the
 * aliases himalaya asks for during setup are inbox/sent/drafts/trash.
 *
 * Matching translated folder names by hand is a losing game; it is here as a
 * backstop, not a strategy. When neither works these return null and the caller
 * says it cannot archive, because mail moved to the wrong folder looks exactly
 * like mail that vanished.
 */

/** himalaya folder aliases, resolved by himalaya itself from the user's config. */
export const TRASH_ALIAS = 'trash'

/** Candidate names per action, best first. Matched case-insensitively. */
const ARCHIVE_NAMES = ['archive', 'archives', '[gmail]/all mail', 'all mail', 'archiv', 'アーカイブ', '보관함']
const TRASH_NAMES = ['trash', '[gmail]/trash', 'deleted items', 'deleted messages', 'bin', 'papierkorb', '휴지통']

function pick(folders: string[], candidates: string[]): string | null {
  const available = folders.filter(folder => typeof folder === 'string' && folder.trim())

  for (const candidate of candidates) {
    // Exact match first: a server with both "Archive" and "Archives" should
    // get the one actually named in the list, not whichever sorts first.
    const exact = available.find(folder => folder.trim().toLowerCase() === candidate)

    if (exact) {
      return exact
    }
  }

  for (const candidate of candidates) {
    // Then a suffix match, for servers that namespace everything
    // ("INBOX.Archive", "[Gmail]/All Mail" when we asked for "all mail").
    const nested = available.find(folder => {
      const lower = folder.trim().toLowerCase()

      return lower.endsWith(`/${candidate}`) || lower.endsWith(`.${candidate}`)
    })

    if (nested) {
      return nested
    }
  }

  return null
}

export function archiveFolder(folders: string[]): string | null {
  return pick(folders, ARCHIVE_NAMES)
}

export function trashFolder(folders: string[]): string | null {
  return pick(folders, TRASH_NAMES)
}

/**
 * The row to land on after acting on `id`.
 *
 * Triage is a rhythm — archive, archive, archive — and it only works if the
 * next message is already open. Returning to the top of the list after every
 * action turns a ten-second pass through the inbox into a minute of scrolling.
 *
 * Falls back to the previous row at the end of the list, and null when the
 * list is now empty.
 */
export function nextAfter<T extends { id: string }>(rows: T[], id: string): T | null {
  const index = rows.findIndex(row => row.id === id)

  if (index === -1) {
    return rows[0] ?? null
  }

  return rows[index + 1] ?? rows[index - 1] ?? null
}

interface MailMove {
  id: string
  account: string
  folder: string
  target: string
}

/** Configured aliases win. Only a confirmed missing mailbox permits a fallback;
 * retrying a timed-out mutation could move the same ID from a different folder. */
export async function moveMail(
  move: (options: MailMove) => Promise<unknown>,
  message: Omit<MailMove, 'target'>,
  kind: 'archive' | 'trash',
  folders: string[]
): Promise<void> {
  try {
    await move({ ...message, target: kind })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const fallback = kind === 'archive' ? archiveFolder(folders) : trashFolder(folders)

    if (
      !fallback ||
      fallback.toLowerCase() === kind ||
      !/nonexistent|no such (?:mailbox|folder)|(?:mailbox|folder).*(?:does not exist|not found|unknown)|unknown (?:mailbox|folder)/i.test(
        detail
      )
    )
      {throw error}

    await move({ ...message, target: fallback })
  }
}
