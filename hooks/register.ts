import type { EngineInterface as Engine, Register } from 'claude-code'

// Keep part of the weekly (seven_day) window free until local midnight that
// starts `day` (0 = Sunday). `pct` is exact; `hours` converts with the rate
// this mod measures from your own turns (weekly-% per hour of active work).
type Reserve = { day: number; until: number; hours?: number; pct?: number }
type Rate = { pct: number; hours: number }

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DEFAULT_PCT_PER_HOUR = 4 // a guess, used until 30 min of your own work is measured
const OVERRIDE = '!!'
const DAY_MS = 86_400_000

function nextDayStart(now: number, day: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  let add = (day - d.getDay() + 7) % 7
  if (add === 0) add = 7 // "mon" said on a Monday means next Monday
  d.setDate(d.getDate() + add)
  return d.getTime()
}

const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

let weekly: { pct: number; resetsAt?: number } | undefined
let turnStart = 0
let warned = false

async function getReserve($: Engine) {
  return (await $.store.get('reserve')) as Reserve | undefined
}
async function getRate($: Engine) {
  const r = (await $.store.get('rate')) as Rate | undefined
  const learned = r !== undefined && r.hours >= 0.5 && r.pct > 0
  return { perHour: learned ? r.pct / r.hours : DEFAULT_PCT_PER_HOUR, learned, raw: r }
}

async function verdict($: Engine) {
  const r = await getReserve($)
  if (!r) return { kind: 'none' as const }
  const now = await $.clock.now()
  if (now >= r.until + DAY_MS) {
    await $.store.delete('reserve')
    return { kind: 'none' as const }
  }
  const pct = r.pct ?? Math.round((r.hours ?? 0) * (await getRate($)).perHour * 10) / 10
  const label = `${DAYS[r.day]} ${r.pct !== undefined ? `${r.pct}%` : `${r.hours}h≈${pct}%`}`
  if (now >= r.until) return { kind: 'released' as const, label, pct, r }
  if (weekly?.resetsAt !== undefined && weekly.resetsAt <= r.until)
    return { kind: 'moot' as const, label, pct, r }
  const allowed = Math.max(0, Math.round((100 - pct) * 10) / 10)
  return { kind: 'guarding' as const, label, pct, r, allowed, used: weekly?.pct }
}

async function refreshStatus($: Engine) {
  const v = await verdict($)
  if (v.kind === 'none') return $.ui.status(undefined)
  if (v.kind === 'released') return $.ui.status(`reserve ${v.label}: released, it's the day`)
  if (v.kind === 'moot') return $.ui.status(`reserve ${v.label}: week resets before then`)
  $.ui.status(`reserve ${v.label} · week ${v.used ?? '?'}% / ${v.allowed}% allowed`)
}

// Readings: also learn the rate from every rise of the weekly figure.
async function readWeekly($: Engine, limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]) {
  const w = limits.find(l => l.kind === 'seven_day')
  if (!w) return
  const prev = weekly?.pct
  weekly = { pct: w.percentUsed, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : undefined }
  if (prev !== undefined && w.percentUsed > prev) {
    const r = ((await $.store.get('rate')) as Rate | undefined) ?? { pct: 0, hours: 0 }
    await $.store.set('rate', { ...r, pct: r.pct + (w.percentUsed - prev) })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'reserve',
      description: 'Hold weekly usage for a day: /reserve mon 2h · /reserve mon 15% · /reserve off · /reserve',
    })
    await readWeekly($, (await $.session.usage()).rateLimits)
    await refreshStatus($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await readWeekly($, e.rateLimits)
    await refreshStatus($)
    const v = await verdict($)
    if (v.kind === 'guarding' && v.used !== undefined) {
      const near = v.used >= v.allowed - 5
      if (near && !warned)
        $.ui.toast(`Weekly usage at ${v.used}%. Prompts stop at ${v.allowed}% to keep your ${v.label} reserve.`)
      warned = near
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    const v = await verdict($)
    if (v.kind === 'guarding' && v.used !== undefined && v.used >= v.allowed) {
      if (!e.text.startsWith(OVERRIDE))
        return {
          drop:
            `usage-reserve: weekly usage is ${v.used}%, and ${v.pct}% is held for ${fmtDate(v.r.until)}. ` +
            `Start the prompt with ${OVERRIDE} to send anyway, or run /reserve off.`,
        }
      e = { ...e, text: e.text.slice(OVERRIDE.length).trimStart() }
    }
    if (!turnStart) turnStart = await $.clock.now()
    return next(e)
  })

  // Active time, for the rate.
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (turnStart) {
      const hours = ((await $.clock.now()) - turnStart) / 3_600_000
      turnStart = 0
      const r = ((await $.store.get('rate')) as Rate | undefined) ?? { pct: 0, hours: 0 }
      await $.store.set('rate', { ...r, hours: r.hours + hours })
    }
    return out
  })

  on('command.run', { command: 'reserve' }, async ($, e) => {
    const args = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const now = await $.clock.now()

    if (args[0] === 'off' || args[0] === 'clear') {
      await $.store.delete('reserve')
      await refreshStatus($)
      return { text: 'Reserve removed.' }
    }

    if (args.length === 0) {
      const v = await verdict($)
      const rate = await getRate($)
      const rateLine = rate.learned
        ? `Measured rate: ~${rate.perHour.toFixed(1)}% of the week per active hour.`
        : `Rate not measured yet (needs 30 min of work); assuming ${DEFAULT_PCT_PER_HOUR}%/hour. Use a % reserve for an exact amount.`
      const week = weekly
        ? `Week: ${weekly.pct}% used${weekly.resetsAt ? `, resets ${fmtDate(weekly.resetsAt)}` : ''}.`
        : 'Week: no reading yet (it arrives after the first reply).'
      if (v.kind === 'none') return { text: `No reserve set. ${week}\n${rateLine}\nUsage: /reserve mon 2h  or  /reserve mon 15%` }
      const state =
        v.kind === 'guarding' ? `holding ${v.pct}%, prompts stop at ${v.allowed}%`
        : v.kind === 'released' ? 'released (it is the day)'
        : 'not needed, the week resets before then'
      return { text: `Reserve for ${fmtDate(v.r.until)}: ${v.label}, ${state}. ${week}\n${rateLine}` }
    }

    const day = DAYS.findIndex(d => (args[0] ?? '').startsWith(d))
    const amount = args[1]?.match(/^(\d+(?:\.\d+)?)(h|%)$/)
    if (day < 0 || !amount) return { text: 'Usage: /reserve mon 2h · /reserve mon 15% · /reserve off · /reserve' }
    const n = Number(amount[1])
    if (amount[2] === '%' && (n <= 0 || n >= 100)) return { text: 'A percent reserve must be between 0 and 100.' }

    const until = nextDayStart(now, day)
    const reserve: Reserve = amount[2] === '%' ? { day, until, pct: n } : { day, until, hours: n }
    await $.store.set('reserve', reserve)
    warned = false
    await refreshStatus($)
    const v = await verdict($)
    const rate = await getRate($)
    const extra =
      v.kind === 'moot' ? ' Note: your weekly window resets before then, so nothing needs holding back.'
      : amount[2] === 'h' && !rate.learned ? ` ${n}h is estimated at ${DEFAULT_PCT_PER_HOUR}%/hour until your own rate is measured.`
      : ''
    return {
      text: `Reserved ${v.kind === 'none' ? '' : v.label} for ${fmtDate(until)}. ` +
        `Until then, prompts are held once weekly usage reaches ${v.kind === 'guarding' ? v.allowed : 100 - (v.kind === 'none' ? 0 : v.pct)}%.${extra}`,
    }
  })
}
