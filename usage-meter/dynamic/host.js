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
      const escapedKey = key.replace(/'/g, "'\\''")
      const req = { command: "curl -sS -m 15 -H 'Authorization: Bearer " + escapedKey + "' '" + url + "'", maxOutputBytes: 65536 }
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
      const n = { 'deepseek-official': 'DS', 'opencode-go': 'OG', 'command-code': 'CC' }
      if (llm !== undefined) {
        try {
          for (const p of llm.listProviders()) { if (p && p.id) n[p.id] = (p.name && p.name.length ? p.name : n[p.id]) || p.id }
          for (const p of llm.listConfigurableProviders()) { if (p && p.provider) { if (!n[p.provider]) n[p.provider] = p.displayName || p.provider } }
        } catch (e) {}
      }
      return n
    }

    // Command Code (cmdc) plan metadata, mirrored from the CLI's own tables:
    // plan id (longest-prefix match) -> display name / monthly allowance in USD.
    const CC_PLAN_NAMES = { 'individual-go': 'Go', 'individual-go-v1': 'Go', 'individual-goat': 'GOAT', 'individual-pro': 'Pro', 'individual-pro-v1': 'Pro', 'individual-provider': 'Provider', 'individual-max': 'Max', 'individual-ultra': 'Ultra', 'teams-pro': 'Teams Pro' }
    const CC_PLAN_CREDITS = { 'individual-go': 10, 'individual-go-v1': 10, 'individual-goat': 70, 'individual-pro': 30, 'individual-pro-v1': 80, 'individual-provider': 15 }
    const CC_PLAN_KEYS = Object.keys(CC_PLAN_CREDITS).sort((a, b) => b.length - a.length)

    function ccPlanId(raw) {
      if (typeof raw !== 'string' || raw === '') return null
      const normalized = raw.toLowerCase().replace(/_/g, '-')
      for (const key of CC_PLAN_KEYS) { if (normalized.startsWith(key)) return key }
      return null
    }

    function toNumber(v) {
      const n = Number(v)
      return isFinite(n) ? n : null
    }

    function round2(v) { return Math.round(v * 100) / 100 }

    function ccWindow(w) {
      if (w === null || w === undefined) return null
      const used = toNumber(w.used)
      const cap = toNumber(w.cap)
      const percent = used !== null && cap !== null && cap > 0 ? round2(Math.min(used / cap * 100, 100)) : null
      return { used: used, cap: cap, percent: percent, exceeded: w.exceeded === true, resetsAt: toNumber(w.resetAt) }
    }

    // `credits.monthlyCredits` counts down (remaining allowance), so the plan
    // allowance table supplies the monthly pool size.
    function commandCodeProvider(credits, subscription, displayName) {
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
      return {
        provider: 'command-code', name: displayName, kind: 'usage', ok: c !== null || s !== null,
        planId: planId, plan: planId !== null ? CC_PLAN_NAMES[planId] : null,
        status: s && typeof s.status === 'string' ? s.status : null,
        periodEnd: s && typeof s.currentPeriodEnd === 'string' ? s.currentPeriodEnd : null,
        monthlyRemaining: monthlyRemaining === null ? null : round2(monthlyRemaining),
        monthlyTotal: planCredits,
        monthlyUsed: used === null ? null : round2(used),
        usagePercent: pool !== null && pool > 0 && used !== null ? round2(Math.min(used / pool * 100, 100)) : null,
        purchased: round2(purchased), free: round2(free),
        rolling: ccWindow(limits ? limits.fiveHour : null), weekly: ccWindow(limits ? limits.weekly : null),
      }
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
            const numOrEmpty = (v) => (v != null ? v : '')
            result.providers.push({ provider: 'deepseek-official', name: n['deepseek-official'], kind: 'balance', ok: b !== undefined,
              currency: numOrEmpty(b ? b.currency : ''), total: numOrEmpty(b ? b.total_balance : ''), granted: numOrEmpty(b ? b.granted_balance : ''), toppedUp: numOrEmpty(b ? b.topped_up_balance : '') })
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
            const pick = (w) => {
              if (!usage[w]) return null
              const num = Number(usage[w].percent)
              return { percent: isNaN(num) ? 0 : num, resetsAt: usage[w].resetsAt }
            }
            result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: true,
              rolling: pick('rolling'), weekly: pick('weekly'), monthly: pick('monthly') })
          } catch (e) { result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false }) }
        } else result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false })
      } else result.providers.push({ provider: 'opencode-go', name: n['opencode-go'], kind: 'usage', ok: false })

      const ccKey = await resolveKey('COMMAND_CODE_API_KEY')
      if (ccKey !== undefined) {
        const base = 'https://api.commandcode.ai'
        const [creditsText, subscriptionText] = await Promise.all([
          fetchText(base + '/alpha/billing/credits', ccKey),
          fetchText(base + '/alpha/billing/subscriptions', ccKey),
        ])
        const parse = (t) => { if (t == null) return null; try { return JSON.parse(t) } catch (e) { return null } }
        result.providers.push(commandCodeProvider(parse(creditsText), parse(subscriptionText), n['command-code']))
      } else result.providers.push({ provider: 'command-code', name: n['command-code'], kind: 'usage', ok: false })

      return result
    })
  },
}
