/**
 * Vault contributions: panes (tree + editor), the "Notes" layout preset, and
 * palette/keybind entries. Registered from controller.tsx after the core
 * surfaces so the vault slots into the same contribution registry plugins use.
 */

import { PALETTE_AREA, type PaletteContribution } from '@/app/command-palette/contrib'
import { IdleMount } from '@/components/idle-mount'
import { group, split } from '@/components/pane-shell/tree/model'
import { applyLayoutPreset } from '@/components/pane-shell/tree/presets'
import { revealTreePane } from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import { type KeybindContribution, KEYBINDS_AREA } from '@/lib/keybinds/actions'

import { VaultEditorPane } from '../vault/editor-pane'
import { VaultTreePane } from '../vault/tree-pane'
import { initVaultStore } from '../vault/store'

// Tree left │ editor main │ chat beside it — the "agent works next to my
// note" arrangement. Chat keeps ~38% so the composer stays usable.
const NOTES_TREE = split(
  'row',
  [group(['vault-tree'], { id: 'grp-vault-tree' }), group(['vault-editor'], { id: 'grp-vault-editor' }), group(['workspace'], { id: 'grp-main' })],
  [1, 2.6, 2.2],
  'spl-notes-root'
)

const openNotesLayout = () => {
  applyLayoutPreset('notes', NOTES_TREE)
  revealTreePane('vault-editor')
}

export function registerVaultContributions(): void {
  initVaultStore()

  registry.registerMany([
    {
      id: 'vault-tree',
      area: 'panes',
      title: 'notes',
      data: {
        placement: 'left',
        collapsible: true,
        dock: { pane: 'vault-editor', pos: 'left' },
        width: '240px',
        minWidth: '180px',
        maxWidth: '400px'
      },
      render: () => (
        <IdleMount>
          <VaultTreePane />
        </IdleMount>
      )
    },
    {
      id: 'vault-editor',
      area: 'panes',
      title: 'editor',
      data: {
        placement: 'main',
        minWidth: '20vw',
        dock: { pane: 'workspace', pos: 'left' }
      },
      render: () => (
        <IdleMount>
          <VaultEditorPane />
        </IdleMount>
      )
    },
    { id: 'notes', area: 'layouts', title: 'Notes', order: 5, data: NOTES_TREE },
    {
      id: 'vault.openNotes',
      area: PALETTE_AREA,
      data: {
        id: 'vault.openNotes',
        label: 'Open Notes layout',
        action: 'vault.openNotes',
        keywords: ['notes', 'vault', 'editor', 'markdown', 'second brain'],
        run: openNotesLayout
      } satisfies PaletteContribution
    },
    {
      id: 'vault.openNotes',
      area: KEYBINDS_AREA,
      data: {
        id: 'vault.openNotes',
        label: 'Open Notes layout',
        defaults: ['mod+e'],
        run: openNotesLayout
      } satisfies KeybindContribution
    }
  ])
}
