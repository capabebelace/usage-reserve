import { expect, test } from 'claude-code/testing'

// Friday 2026-11-20 12:00 local.
const NOW = new Date(2026, 10, 20, 12).getTime()
const RESETS = new Date(2026, 10, 25, 12).toISOString() // Wednesday: after Monday

function engine(on: any, weeklyPct: number) {
  const store: Record<string, unknown> = {}
  on('command.register', () => ({ value: { command: 'reserve' } }))
  on('clock.now', () => ({ value: NOW }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('store.delete', (_: any, e: any) => (delete store[e.key], { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: weeklyPct, resetsAt: RESETS }] },
  }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  return store
}

test('a 15% Monday reserve blocks prompts at 85% weekly use, !! overrides', async ($, on) => {
  const store = engine(on, 90)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const set = await $.command.run({ command: 'reserve', args: 'mon 15%' } as any)
  expect(set.text).toMatch(/85%/)
  expect((store.reserve as any).until).toBe(new Date(2026, 10, 23).getTime())

  const blocked = await $.prompt.submit({ text: 'hello', wait: false } as any)
  expect((blocked as any).drop).toMatch(/90%/)

  const forced = await $.prompt.submit({ text: '!! hello', wait: false } as any)
  expect((forced as any).text).toBe('hello')
})

test('under the line, prompts go through', async ($, on) => {
  engine(on, 50)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'reserve', args: 'mon 2h' } as any)
  const ok = await $.prompt.submit({ text: 'hello', wait: false } as any)
  expect((ok as any).text).toBe('hello')
})
