// Host half of the "Provider Usage Meter" dynamic Cordis Plugin.
// This is the exact function body passed to `cordis_define` as `code.host`
// (plain JavaScript, evaluated in the DSH host vm sandbox — no TypeScript, JSX,
// import, or require, and no global fetch / timers / process).

return {
  name: 'usage-meter-host',
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const credentials = ctx.get('credentials')
    const llm = ctx.get('llm')

    async function resolveKey(ref) {
      if (credentials === undefined) return undefined
      try {
        const r = await credentials.resolve(ref)
        return r === undefined ? undefined : r.value
      } catch (e) {
        return undefined
      }
    }

    async function fetchJson(url, key) {
      if (subprocess === undefined) throw new Error('subprocess service unavailable')
      const proc = subprocess.spawn({
        argv: ['curl', '-sS', '-m', '12', '-H', 'Authorization: Bearer ' + key, url],
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 32768 }, stderr: { maxBytes: 8192 } },
        graceMs: 3000,
      })
      const outcome = await proc.done
      if (outcome.exitCode !== 0) {
        const errText = proc.collected.stderr ? proc.collected.stderr.readFrom(0).text : ''
        throw new Error('curl exit ' + outcome.exitCode + (errText ? ': ' + errText : ''))
      }
      const out = proc.collected.stdout ? proc.collected.stdout.readFrom(0).text : ''
      try { return JSON.parse(out) } catch (e) { throw new Error('non-JSON: ' + String(out).slice(0, 200)) }
    }

    function names() {
      const n = { 'deepseek-official': 'DeepSeek 官方', 'opencode-go': 'OpenCode Go' }
      if (llm !== undefined) {
        try {
          for (const p of llm.listProviders()) { if (p && p.id) n[p.id] = (p.name && p.name.length ? p.name : n[p.id]) || p.id }
          for (const p of llm.listConfigurableProviders()) { if (p && p.provider) { if (!n[p.provider]) n[p.provider] = p.displayName || p.provider } }
        } catch (e) {}
      }
      return n
    }

    harness.handle('getUsage', async () => {
      const result = { providers: [], fetchedAt: Date.now() }
      const n = names()

      const dsKey = await resolveKey('DEEPSEEK_API_KEY')
      if (dsKey !== undefined) {
        try {
          const bal = await fetchJson('https://api.deepseek.com/user/balance', dsKey)
          const b = bal && bal.balance_infos && bal.balance_infos[0]
          result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: true,
            currency: b ? b.currency : '', total: b ? b.total_balance : '', granted: b ? b.granted_balance : '', toppedUp: b ? b.topped_up_balance : '' })
        } catch (e) { result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: false, error: String(e && e.message ? e.message : e) }) }
      } else result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: false, error: 'no DEEPSEEK_API_KEY' })

      const ogKey = await resolveKey('OPENCODE_GO_API_KEY')
      if (ogKey !== undefined) {
        try {
          const u = await fetchJson('https://opencode.ai/zen/go/v1/usage', ogKey)
          const usage = u && u.usage ? u.usage : {}
          const pick = (w) => (usage[w] ? { percent: usage[w].percent, resetsAt: usage[w].resetsAt } : null)
          result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: true,
            rolling: pick('rolling'), weekly: pick('weekly'), monthly: pick('monthly') })
        } catch (e) { result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false, error: String(e && e.message ? e.message : e) }) }
      } else result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false, error: 'no OPENCODE_GO_API_KEY' })

      return result
    })
  },
}
