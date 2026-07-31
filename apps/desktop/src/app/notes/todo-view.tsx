/**
 * Todo screen — every checkbox task in the vault, grouped the way people
 * actually plan (Overdue / Today / Upcoming / Someday / Done). Tasks stay
 * plain markdown in their notes; this is a lens, not a store.
 *
 * Due dates are read from the task text: `📅 2026-08-01`, `due:2026-08-01`,
 * or a bare `@2026-08-01` — all conventions users already type.
 */

import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

import { openNote } from '../vault/store'
import { todayStamp } from './templates'
import { $vaultTodos, initTodosStore, refreshTodos, toggleTodo, type VaultTodo } from './todos-store'
import { closeTableView } from './view-store'

const DUE_RE = /(?:📅\s*|due:\s*|@)(\d{4}-\d{2}-\d{2})/i

export interface DecoratedTodo extends VaultTodo {
  due: string | null
  /** Task text with the due marker removed. */
  label: string
  note: string
}

export function decorateTodo(todo: VaultTodo): DecoratedTodo {
  const match = DUE_RE.exec(todo.text)

  return {
    ...todo,
    due: match ? match[1] : null,
    label: todo.text.replace(DUE_RE, '').replace(/\s{2,}/g, ' ').trim(),
    note: todo.path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? todo.path
  }
}

export type TodoGroup = 'overdue' | 'today' | 'upcoming' | 'someday' | 'done'

export function groupTodo(todo: DecoratedTodo, today = todayStamp()): TodoGroup {
  if (todo.done) {
    return 'done'
  }

  if (!todo.due) {
    return 'someday'
  }

  if (todo.due < today) {
    return 'overdue'
  }

  return todo.due === today ? 'today' : 'upcoming'
}

const GROUP_LABEL: Record<TodoGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  someday: 'No date',
  done: 'Done'
}

const GROUP_ORDER: TodoGroup[] = ['overdue', 'today', 'upcoming', 'someday', 'done']

function duePill(todo: DecoratedTodo, today: string): { text: string; tone: string } | null {
  if (!todo.due) {
    return null
  }

  if (todo.due < today) {
    return { text: todo.due, tone: 'var(--sem-late-wash)' }
  }

  if (todo.due === today) {
    return { text: 'Today', tone: 'var(--sem-soon-wash)' }
  }

  return { text: todo.due, tone: 'var(--sem-good-wash)' }
}

export function TodoView() {
  const todos = useStore($vaultTodos)
  const [showDone, setShowDone] = useState(false)
  const today = todayStamp()

  initTodosStore()

  const groups = useMemo(() => {
    const decorated = todos.map(decorateTodo)
    const byGroup = new Map<TodoGroup, DecoratedTodo[]>()

    for (const todo of decorated) {
      const group = groupTodo(todo, today)
      const list = byGroup.get(group) ?? []

      list.push(todo)
      byGroup.set(group, list)
    }

    for (const [, list] of byGroup) {
      list.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.label.localeCompare(b.label))
    }

    return byGroup
  }, [todos, today])

  const openCount = todos.filter(todo => !todo.done).length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[46rem] px-6 pb-12 pt-8">
        <div className="mb-5 flex items-baseline gap-3">
          <h1 className="text-[28px] font-(--dt-font-serif) font-medium tracking-[-0.01em]">Todo</h1>
          <span className="text-xs opacity-45">{openCount} open</span>
          <button
            className="ml-auto rounded-md px-2 py-1 text-[12.5px] opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
            onClick={() => void refreshTodos()}
          >
            Refresh
          </button>
          <button
            className="rounded-md px-2 py-1 text-[12.5px] opacity-60 transition-all hover:bg-(--ui-control-hover-background) hover:opacity-100"
            onClick={() => setShowDone(value => !value)}
          >
            {showDone ? 'Hide done' : 'Show done'}
          </button>
        </div>

        {!todos.length ? (
          <div className="rounded-xl border border-(--stroke-nous) p-6 text-center text-[13px] opacity-60">
            No tasks yet. Type <kbd className="rounded bg-(--ui-control-hover-background) px-1">/</kbd> in any note and
            pick “To-do list”, or add <code>- [ ] something 📅 {today}</code>.
          </div>
        ) : null}

        {GROUP_ORDER.filter(group => group !== 'done' || showDone).map(group => {
          const list = groups.get(group) ?? []

          if (!list.length) {
            return null
          }

          return (
            <section key={group} className="mb-6">
              <div className="mb-1.5 flex items-baseline gap-2">
                <h2 className="text-[13px] font-semibold">{GROUP_LABEL[group]}</h2>
                <span className="text-[11px] opacity-40">{list.length}</span>
              </div>
              <div className="flex flex-col">
                {list.map(todo => {
                  const pill = duePill(todo, today)

                  return (
                    <div
                      key={`${todo.path}:${todo.line}`}
                      className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-(--ui-control-hover-background)"
                    >
                      <button
                        className="grid size-[16px] shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors"
                        style={
                          todo.done
                            ? { backgroundColor: 'var(--dt-primary)', borderColor: 'var(--dt-primary)' }
                            : { borderColor: 'var(--ui-stroke-secondary)' }
                        }
                        onClick={() => void toggleTodo(todo)}
                        title={todo.done ? 'Mark as not done' : 'Mark as done'}
                      >
                        {todo.done ? (
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2.5 6.3 4.8 8.6 9.5 3.6" />
                          </svg>
                        ) : null}
                      </button>
                      <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', todo.done && 'line-through opacity-45')}>
                        {todo.label || '(empty task)'}
                      </span>
                      {pill ? (
                        <span
                          className="shrink-0 rounded-md px-1.5 py-px text-[11px]"
                          style={{ backgroundColor: pill.tone }}
                        >
                          {pill.text}
                        </span>
                      ) : null}
                      <button
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-90"
                        title={todo.path}
                        onClick={() => {
                          closeTableView()
                          void openNote(todo.path)
                        }}
                      >
                        {todo.note}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
