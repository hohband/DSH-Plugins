// Host half of the persistent "usage-meter" plugin.
// Loaded by the Cordis Loader from the profile patch layer (ESM).
// Registers a /usage-meter HTTP route that queries the two provider
// endpoints with curl (via the subprocess service) and returns JSON.

export const name = 'usage-meter'
export const inject = ['webServer']

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

async function curlJson(ctx, url, key) {
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
      try {
        const result = { providers: [] }

        const dsKey = await resolveKey(ctx, 'DEEPSEEK_API_KEY')
        if (dsKey !== undefined) {
          const bal = await curlJson(ctx, 'https://api.deepseek.com/user/balance', dsKey)
          const b = bal && bal.balance_infos ? bal.balance_infos[0] : undefined
          result.providers.push({
            provider: 'deepseek-official',
            name: 'DS',
            kind: 'balance',
            ok: b !== undefined,
            currency: b ? b.currency : '',
            total: b ? b.total_balance : '',
            granted: b ? b.granted_balance : '',
            toppedUp: b ? b.topped_up_balance : '',
          })
        } else {
          result.providers.push({ provider: 'deepseek-official', name: 'DS', kind: 'balance', ok: false })
        }

        const ogKey = await resolveKey(ctx, 'OPENCODE_GO_API_KEY')
        if (ogKey !== undefined) {
          const u = await curlJson(ctx, 'https://opencode.ai/zen/go/v1/usage', ogKey)
          const usage = u && u.usage ? u.usage : {}
          const pick = (w) => (usage[w] ? { percent: usage[w].percent, resetsAt: usage[w].resetsAt } : null)
          result.providers.push({
            provider: 'opencode-go',
            name: 'OG',
            kind: 'usage',
            ok: true,
            rolling: pick('rolling'),
            weekly: pick('weekly'),
            monthly: pick('monthly'),
          })
        } else {
          result.providers.push({ provider: 'opencode-go', name: 'OG', kind: 'usage', ok: false })
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
