import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { queryClient } from '@/lib/query-client'
import { setCronJobs } from '@/store/cron'
import { $activeGatewayProfile } from '@/store/profile'

import { CronView } from './index'

const api = vi.fn()
beforeEach(() => {
  setCronJobs([])
  $activeGatewayProfile.set('work')
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
  api.mockImplementation(async (request: { path: string; method?: string; body?: Record<string, unknown> }) => {
    if (request.path.includes('/blueprints')) {return { blueprints: [] }}

    if (request.path.includes('/delivery-targets'))
      {return { targets: [{ value: 'local', label: 'This desktop', available: true }] }}

    if (request.path.includes('/model/options')) {return { providers: [] }}

    if (request.path.includes('/runs')) {return { runs: [] }}

    if (request.method === 'POST') {return { id: 'new', profile: 'work', enabled: true, ...request.body }}

    return []
  })
})
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider configClient={null} initialLocale="ko">
        <MemoryRouter>
          <CronView embedded onClose={() => {}} />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>
  )
}

it('creates an automation from the dedicated Korean page in its current profile', async () => {
  const view = mount()
  fireEvent.click(await screen.findByRole('button', { name: '새 자동화' }))
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: '아침 정리' } })
  fireEvent.change(screen.getByLabelText('할 일'), { target: { value: '오늘의 할 일을 정리해 주세요.' } })
  fireEvent.click(screen.getByRole('button', { name: '자동화 만들기' }))
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/cron/jobs?profile=work',
        profile: 'work',
        body: expect.objectContaining({
          name: '아침 정리',
          prompt: '오늘의 할 일을 정리해 주세요.',
          schedule: '0 9 * * *'
        })
      })
    )
  )
  await screen.findByRole('heading', { name: '아침 정리' })
  expect(view.container.querySelector('[data-automation-page]')).not.toBeNull()
})

it('shows a retryable load error instead of claiming there are no jobs', async () => {
  api.mockRejectedValue(new Error('offline'))
  mount()
  expect((await screen.findByRole('alert')).textContent).toContain('자동화 정보를 불러오지 못했습니다')
  expect(screen.queryByText('아직 자동화가 없습니다')).toBeNull()
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeDefined()
})
