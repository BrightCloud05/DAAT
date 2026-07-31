/** Which surface the document canvas shows: Home, a note, or the table. */

import { atom } from 'nanostores'

export type CanvasView = 'home' | 'note' | 'table' | 'todo' | 'mail' | 'money' | 'calendar' | 'meetings' | 'graph'

export const $canvasView = atom<CanvasView>('home')

export function openHomeView(): void {
  $canvasView.set('home')
}

export function openTableView(): void {
  $canvasView.set('table')
}

export function openTodoView(): void {
  $canvasView.set('todo')
}

export function openMailView(): void {
  $canvasView.set('mail')
}

export function openMoneyView(): void {
  $canvasView.set('money')
}

export function openCalendarView(): void {
  $canvasView.set('calendar')
}

export function openMeetingsView(): void {
  $canvasView.set('meetings')
}

export function closeTableView(): void {
  $canvasView.set('note')
}

export function openGraphView(): void {
  $canvasView.set('graph')
}
