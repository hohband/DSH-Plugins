// Client half of the "Provider Usage Meter" dynamic Cordis Plugin.
// This is the exact function body passed to `cordis_define` as `code.client`
// (plain JavaScript, evaluated by the client-side runner — no TypeScript, JSX,
// import, or require; no window / document globals; React.createElement only).

return {
  name: 'usage-meter-client',
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const timer = ctx.get('timer')

    styles.insert(`
      .um-btn { background: none; border: none; color: inherit; cursor: pointer; padding: 0; display: flex; align-items: center; gap: 6px; width: 100%; }
      .um-panel { position: fixed; left: 8px; bottom: 56px; z-index: 10000; background: #1e1f24; border: 1px solid #2c2d33; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); padding: 10px 12px; font-size: 12px; color: #e6e6e6; width: 230px; }
      .um-item { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
      .um-item:last-child { border-bottom: none; }
      .um-title { font-weight: 600; margin-bottom: 4px; }
      .um-row { display: flex; justify-content: space-between; padding: 1px 0; }
      .um-k { color: #9a9aa3; }
      .um-v { font-variant-numeric: tabular-nums; }
      .um-err { color: #f87171; }
      .um-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
      .um-refresh { background: none; border: none; color: #7d8bff; cursor: pointer; font-size: 11px; padding: 0; }
    `)

    function UsagePanel() {
      const [open, setOpen] = React.useState(false)
      const [data, setData] = React.useState(null)

      function load() {
        host.call('getUsage', {}).then((d) => setData(d)).catch((e) => setData({ providers: [], fetchedAt: Date.now(), error: String(e) }))
      }

      React.useEffect(() => {
        let stopInterval = null
        if (timer) stopInterval = timer.interval(load, 60000)
        load()
        return () => { if (stopInterval) stopInterval() }
      }, [])

      function summary() {
        if (!data || !data.providers) return '…'
        const parts = []
        for (const p of data.providers) {
          if (p.ok && p.kind === 'balance' && p.total) parts.push(p.total + (p.currency || ''))
          else if (p.ok && p.kind === 'usage' && p.weekly) parts.push(p.weekly.percent + '%')
        }
        return parts.join(' · ') || '…'
      }

      const btn = React.createElement('button', { className: 'um-btn', onClick: () => { setOpen(!open); if (!open) load() }, title: 'Provider 额度' },
        React.createElement('span', null, '⚡'),
        React.createElement('span', null, summary()),
      )

      let panel = null
      if (open) {
        const items = (data && data.providers ? data.providers : []).map((p) => {
          let body
          if (!p.ok) body = React.createElement('div', { className: 'um-err' }, '⚠ ' + (p.error || 'error'))
          else if (p.kind === 'balance') {
            body = React.createElement('div', null,
              React.createElement('div', { className: 'um-row' }, React.createElement('span', { className: 'um-k' }, '剩余额度'), React.createElement('span', { className: 'um-v' }, p.total + ' ' + (p.currency || ''))),
              React.createElement('div', { className: 'um-row' }, React.createElement('span', { className: 'um-k' }, '充值余额'), React.createElement('span', { className: 'um-v' }, p.toppedUp + ' ' + (p.currency || ''))),
              React.createElement('div', { className: 'um-row' }, React.createElement('span', { className: 'um-k' }, '赠送余额'), React.createElement('span', { className: 'um-v' }, p.granted + ' ' + (p.currency || ''))),
            )
          } else if (p.kind === 'usage') {
            const rows = []
            const add = (label, u) => { if (u) rows.push(React.createElement('div', { className: 'um-row' }, React.createElement('span', { className: 'um-k' }, label), React.createElement('span', { className: 'um-v' }, u.percent + '%'))) }
            add('滚动(5h)', p.rolling); add('本周', p.weekly); add('本月', p.monthly)
            if (rows.length === 0) rows.push(React.createElement('div', null, '无数据'))
            body = React.createElement('div', null, rows)
          }
          return React.createElement('div', { className: 'um-item', key: p.provider },
            React.createElement('div', { className: 'um-title' }, p.name), body)
        })
        panel = React.createElement('div', { className: 'um-panel' },
          React.createElement('div', { className: 'um-head' },
            React.createElement('span', null, 'Provider 额度'),
            React.createElement('button', { className: 'um-refresh', onClick: load }, '刷新'),
          ),
          items,
        )
      }

      return React.createElement('div', null, btn, panel)
    }

    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'usage-meter', order: 100, label: 'Provider 额度' },
      () => React.createElement(UsagePanel),
    ))
  },
}
