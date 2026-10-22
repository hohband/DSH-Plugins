// Host half of the persistent "usage-meter" plugin.
// Loaded by the Cordis Loader from the profile patch layer (ESM).
// Registers a /usage-meter HTTP route that queries the provider
// endpoints with curl (via the subprocess service) and returns JSON.

export const name = 'usage-meter'
export const inject = ['webServer', 'subprocess']

// Command Code (cmdc) plan metadata, mirrored from the CLI's own tables:
// plan id (longest-prefix match) -> display name / monthly allowance in USD.
const CC_PLAN_NAMES = {
  'individual-go': 'Go',
  'individual-go-v1': 'Go',
  'individual-goat': 'GOAT',
  'individual-pro': 'Pro',
  'individual-pro-v1': 'Pro',
  'individual-provider': 'Provider',
  'individual-max': 'Max',
  'individual-ultra': 'Ultra',
  'teams-pro': 'Teams Pro',
}
const CC_PLAN_CREDITS = {
  'individual-go': 10,
  'individual-go-v1': 10,
  'individual-goat': 70,
  'individual-pro': 30,
  'individual-pro-v1': 80,
  'individual-provider': 15,
}
const CC_PLAN_KEYS = Object.keys(CC_PLAN_CREDITS).sort((a, b) => b.length - a.length)

function ccPlanId(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  const normalized = raw.toLowerCase().replace(/_/g, '-')
  for (const key of CC_PLAN_KEYS) {
    if (normalized.startsWith(key)) return key
  }
  return null
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function ccWindow(window) {
  if (window === null || window === undefined) return null
  const used = toNumber(window.used)
  const cap = toNumber(window.cap)
  const percent = used !== null && cap !== null && cap > 0 ? round2(Math.min((used / cap) * 100, 100)) : null
  return { used, cap, percent, exceeded: window.exceeded === true, resetsAt: toNumber(window.resetAt) }
}

// Shape one Command Code entry out of `/alpha/billing/credits` plus
// `/alpha/billing/subscriptions`. `monthlyCredits` counts down (it is the
// remaining allowance), so the plan allowance table supplies the pool size.
function commandCodeProvider(credits, subscription) {
  const c = credits !== null && typeof credits === 'object' && credits.credits ? credits.credits : null
  const s = subscription !== null && typeof subscription === 'object' && subscription.data ? subscription.data : null
  const planId = ccPlanId(s ? s.planId : c ? c.planId : null)
  const monthlyRemaining = c ? Math.max(0, toNumber(c.monthlyCredits) || 0) : null
  const purchased = c ? Math.max(0, toNumber(c.purchasedCredits) || 0) : 0
  const free = c ? Math.max(0, toNumber(c.freeCredits) || 0) : 0
  const planCredits = planId !== null && CC_PLAN_CREDITS[planId] !== undefined ? CC_PLAN_CREDITS[planId] : null
  const remaining = monthlyRemaining === null ? null : monthlyRemaining + purchased + free
  const pool = remaining === null ? null : (planCredits !== null ? Math.max(planCredits, monthlyRemaining) + purchased + free : remaining)
  const used = pool !== null && remaining !== null ? Math.max(0, pool - remaining) : null
  const limits = credits !== null && typeof credits === 'object' && credits.windowLimits ? credits.windowLimits : null
  const periodEnd = s && typeof s.currentPeriodEnd === 'string' ? s.currentPeriodEnd : null
  const usagePercent = pool !== null && pool > 0 && used !== null ? round2(Math.min((used / pool) * 100, 100)) : null
  return {
    provider: 'command-code',
    name: 'CC',
    kind: 'usage',
    ok: c !== null || s !== null,
    planId,
    plan: planId !== null ? CC_PLAN_NAMES[planId] : null,
    status: s && typeof s.status === 'string' ? s.status : null,
    periodEnd,
    monthlyRemaining: monthlyRemaining === null ? null : round2(monthlyRemaining),
    monthlyTotal: planCredits,
    monthlyUsed: used === null ? null : round2(used),
    usagePercent,
    purchased: round2(purchased),
    free: round2(free),
    // 三个窗口统一成同一形状(percent / resetsAt / exceeded):5 小时与周取自
    // windowLimits,月取自订阅周期(池子已用占比,重置时间 = 账单周期结束)
    rolling: ccWindow(limits ? limits.fiveHour : null),
    weekly: ccWindow(limits ? limits.weekly : null),
    monthly: { percent: usagePercent, resetsAt: periodEnd, exceeded: false },
  }
}

async function resolveKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  try {
    const r = await credentials.resolve(ref)
    return r === undefined ? undefined : r.value
  } catch (e) {
    return undefined
  }
}

async function curlViaSubprocess(ctx, url, key) {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) return null
  const proc = subprocess.spawn({
    argv: ['curl', '-sS', '-m', '15', '-H', 'Authorization: Bearer ' + key, url],
    cwd: '/',
    stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 16384 } },
    graceMs: 5000,
  })
  const outcome = await proc.done
  if (outcome.exitCode !== 0) return null
  const text = proc.collected.stdout ? proc.collected.stdout.readFrom(0).text : ''
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

// 单个 provider 取数失败只返回 null,由调用方标记 ok: false —— 不能让一个
// provider 的超时/非零退出把整条响应拖成 500(那样面板会整块空掉)。
async function curlJson(ctx, url, key) {
  try {
    return await curlViaSubprocess(ctx, url, key)
  } catch (e) {
    return null
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/usage-meter',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end('{"providers":[],"error":"method not allowed"}')
        return
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      try {
        const result = { providers: [] }

        const dsKey = await resolveKey(ctx, 'DEEPSEEK_API_KEY')
        if (dsKey !== undefined) {
          const bal = await curlJson(ctx, 'https://api.deepseek.com/user/balance', dsKey)
          const b = bal && bal.balance_infos ? bal.balance_infos[0] : undefined
          const numOrEmpty = (v) => (v != null ? v : '')
          result.providers.push({
            provider: 'deepseek-official',
            name: 'DS',
            kind: 'balance',
            ok: b !== undefined,
            currency: numOrEmpty(b ? b.currency : ''),
            total: numOrEmpty(b ? b.total_balance : ''),
            granted: numOrEmpty(b ? b.granted_balance : ''),
            toppedUp: numOrEmpty(b ? b.topped_up_balance : ''),
          })
        } else {
          result.providers.push({ provider: 'deepseek-official', name: 'DS', kind: 'balance', ok: false })
        }

        const ogKey = await resolveKey(ctx, 'OPENCODE_GO_API_KEY')
        if (ogKey !== undefined) {
          const u = await curlJson(ctx, 'https://opencode.ai/zen/go/v1/usage', ogKey)
          const usage = u && u.usage ? u.usage : {}
          const pick = (w) => {
            if (!usage[w]) return null
            const num = Number(usage[w].percent)
            return { percent: isNaN(num) ? 0 : num, resetsAt: usage[w].resetsAt }
          }
          result.providers.push({
            provider: 'opencode-go',
            name: 'OG',
            kind: 'usage',
            ok: u !== null,
            rolling: pick('rolling'),
            weekly: pick('weekly'),
            monthly: pick('monthly'),
          })
        } else {
          result.providers.push({ provider: 'opencode-go', name: 'OG', kind: 'usage', ok: false })
        }

        // Command Code subscription (GOAT / Pro / Go …): remaining monthly
        // credits plus the 5-hour and weekly spend windows, same plan data the
        // CLI's `/usage` screen shows.
        const ccKey = await resolveKey(ctx, 'COMMAND_CODE_API_KEY')
        if (ccKey !== undefined) {
          const base = 'https://api.commandcode.ai'
          const [credits, subscription] = await Promise.all([
            curlJson(ctx, base + '/alpha/billing/credits', ccKey),
            curlJson(ctx, base + '/alpha/billing/subscriptions', ccKey),
          ])
          result.providers.push(commandCodeProvider(credits, subscription))
        } else {
          result.providers.push({ provider: 'command-code', name: 'CC', kind: 'usage', ok: false })
        }

        const body = JSON.stringify(result)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(body)
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ providers: [], error: String(e && e.message ? e.message : e) }))
      }
    },
  }), 'usage-meter: /usage-meter route')
}
