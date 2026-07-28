/** Which surface the document canvas shows: a note, or the All-pages table. */

import { atom } from 'nanostores'

export type CanvasView = 'note' | 'table'

export const $canvasView = atom<CanvasView>('note')

export function openTableView(): void {
  $canvasView.set('table')
}

export function closeTableView(): void {
  $canvasView.set('note')
}
