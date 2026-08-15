// Host half of the "Provider Usage Meter" dynamic Cordis Plugin.
// This is the exact function body passed to `cordis_define` as `code.host`
// (plain JavaScript, evaluated in the DSH host vm sandbox — no TypeScript, JSX,
// import, or require, and no global fetch / timers / process).

return {
  name: 'usage-meter-host',
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const shell = ctx.get('shell')
    const credentials = ctx.get('credentials')
    const llm = ctx.get('llm')

    async function resolveKey(ref) {
      if (credentials === undefined) return undefined
      try {
        const r = await credentials.resolve(ref)
        return r === undefined ? undefined : r.value
      } catch (e) { return undefined }
    }

    async function curlViaSubprocess(url, key) {
      const proc = subprocess.spawn({
        argv: ['curl', '-sS', '-m', '15', '-H', 'Authorization: Bearer ' + key, url],
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 16384 } },
        graceMs: 5000,
      })
      const outcome = await proc.done
      if (outcome.exitCode !== 0) throw new Error('curl exit ' + outcome.exitCode)
      return proc.collected.stdout ? proc.collected.stdout.readFrom(0).text : ''
    }

    async function curlViaShell(url, key) {
      const req = { command: 'curl -sS -m 15 -H "Authorization: Bearer ' + key + '" "' + url + '"', maxOutputBytes: 65536 }
      const spec = shell.resolve(req)
      const result = await shell.run(spec)
      if (result.sandbox && result.sandbox.denied) throw new Error('shell denied')
      const text = result.output ? result.output.text : ''
      if (result.exitCode !== 0) throw new Error('shell exit ' + result.exitCode)
      return text
    }

    // Query the two provider endpoints. Dynamic-plugin host sandbox traps the
    // global `fetch`, so we go through the subprocess service (spawn curl),
    // falling back to the shell service when subprocess is unavailable.
    async function fetchText(url, key) {
      if (subprocess !== undefined) {
        try { return await curlViaSubprocess(url, key) }
        catch (e) {
          if (shell !== undefined) { try { return await curlViaShell(url, key) } catch (e2) {} }
          return null
        }
      }
      if (shell !== undefined) {
        try { return await curlViaShell(url, key) } catch (e) {}
      }
      return null
    }

    function names() {
      const n = { 'deepseek-official': 'DS', 'opencode-go': 'OG' }
      if (llm !== undefined) {
        try {
          for (const p of llm.listProviders()) { if (p && p.id) n[p.id] = (p.name && p.name.length ? p.name : n[p.id]) || p.id }
          for (const p of llm.listConfigurableProviders()) { if (p && p.provider) { if (!n[p.provider]) n[p.provider] = p.displayName || p.provider } }
        } catch (e) {}
      }
      return n
    }

    harness.handle('getUsage', async () => {
      const result = { providers: [] }
      const n = names()

      const dsKey = await resolveKey('DEEPSEEK_API_KEY')
      if (dsKey !== undefined) {
        const t = await fetchText('https://api.deepseek.com/user/balance', dsKey)
        if (t != null) {
          try {
            const bal = JSON.parse(t)
            const b = bal && bal.balance_infos && bal.balance_infos[0]
            result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: true,
              currency: b ? b.currency : '', total: b ? b.total_balance : '', granted: b ? b.granted_balance : '', toppedUp: b ? b.topped_up_balance : '' })
          } catch (e) { result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: false }) }
        } else result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: false })
      } else result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: false })

      const ogKey = await resolveKey('OPENCODE_GO_API_KEY')
      if (ogKey !== undefined) {
        const t = await fetchText('https://opencode.ai/zen/go/v1/usage', ogKey)
        if (t != null) {
          try {
            const u = JSON.parse(t)
            const usage = u && u.usage ? u.usage : {}
            const pick = (w) => (usage[w] ? { percent: usage[w].percent, resetsAt: usage[w].resetsAt } : null)
            result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: true,
              rolling: pick('rolling'), weekly: pick('weekly'), monthly: pick('monthly') })
          } catch (e) { result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false }) }
        } else result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false })
      } else result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false })

      return result
    })
  },
}
