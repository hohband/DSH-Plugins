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
      .um-wrap { position: fixed; right: 8px; bottom: 8px; z-index: 9000; pointer-events: auto; -webkit-app-region: no-drag; app-region: no-drag; }
      .um-wrap.um-placed { right: auto; bottom: auto; }
      .um-wrap.um-dragging { user-select: none; }
      .um-mini { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; background: rgba(24,25,30,.92); border: 1px solid #2c2d33; border-radius: 50%; font-size: 13px; line-height: 1; color: #ffd166; box-shadow: 0 4px 16px rgba(0,0,0,.35); cursor: grab; pointer-events: auto; user-select: none; touch-action: none; -webkit-app-region: no-drag; app-region: no-drag; }
      .um-mini:hover { border-color: #4a4b52; background: rgba(32,33,40,.95); }
      .um-pill { display: inline-flex; align-items: center; gap: 8px; background: rgba(24,25,30,.92); border: 1px solid #2c2d33; border-radius: 8px; padding: 4px 10px; font-size: 11px; line-height: 1.4; color: #cfcfd6; white-space: nowrap; box-shadow: 0 4px 16px rgba(0,0,0,.35); font-variant-numeric: tabular-nums; cursor: grab; pointer-events: auto; touch-action: none; -webkit-app-region: no-drag; app-region: no-drag; }
      .um-wrap.um-dragging .um-pill, .um-wrap.um-dragging .um-mini { cursor: grabbing; }
      .um-dot { color: #ffd166; cursor: pointer; padding: 2px 3px; margin: -2px -3px; border-radius: 4px; }
      .um-dot:hover { background: rgba(255,255,255,.14); }
      .um-sep { color: #3a3b42; }
      .um-name { color: #8a8a93; }
      .um-val { color: #e6e6e6; }
      .um-err { color: #f87171; }
      .um-panel { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 9000; background: #1e1f24; border: 1px solid #2c2d33; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); padding: 10px 12px; font-size: 12px; color: #e6e6e6; width: 240px; pointer-events: auto; -webkit-app-region: no-drag; app-region: no-drag; }
      .um-panel.um-down { bottom: auto; top: calc(100% + 6px); }
      .um-panel.um-left { right: auto; left: 0; }
      .um-head { display: flex; align-items: center; margin-bottom: 4px; }
      .um-head-title { flex: 1; font-weight: 600; }
      .um-close { background: none; border: none; color: #9a9aa3; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
      .um-close:hover { color: #fff; }
      .um-item { padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
      .um-item:last-child { border-bottom: none; }
      .um-title { font-weight: 600; margin-bottom: 4px; }
      .um-row { display: flex; justify-content: space-between; padding: 1px 0; }
      .um-k { color: #9a9aa3; }
      .um-v { font-variant-numeric: tabular-nums; }
    `)

    function fmtPct(v) {
      if (typeof v !== 'number' || !isFinite(v)) return '—'
      return Math.round(v * 10) / 10 + '%'
    }

    function fmtStamp(v) {
      const d = new Date(v)
      if (isNaN(d.getTime())) return ''
      const pad = (n) => (n < 10 ? '0' + n : '' + n)
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }

    // 折叠状态优先存 localStorage(刷新后保持);受限沙箱里取不到时降级为纯内存状态
    const COLLAPSED_KEY = 'usage-meter:collapsed'

    function readCollapsed() {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY) === '1'
      } catch (e) {
        return false
      }
    }

    function writeCollapsed(value) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
      } catch (e) {}
    }

    // 拖拽后的位置存 localStorage(键 usage-meter:pos,{x,y} = 左上角像素);
    // null 表示未拖动过,仍用默认的右下角定位
    const POS_KEY = 'usage-meter:pos'
    const DRAG_THRESHOLD = 6

    function readPos() {
      try {
        if (typeof localStorage === 'undefined') return null
        const raw = localStorage.getItem(POS_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        if (p && isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y }
        return null
      } catch (e) {
        return null
      }
    }

    function writePos(value) {
      try {
        if (typeof localStorage === 'undefined') return
        if (value) localStorage.setItem(POS_KEY, JSON.stringify(value))
        else localStorage.removeItem(POS_KEY)
      } catch (e) {}
    }

    // 位置按视口夹取,保证控件始终完整可见、不会被拖出屏幕
    function clampPos(p, width, height, vw, vh) {
      const x = Math.min(Math.max(p.x, 0), Math.max(0, vw - width))
      const y = Math.min(Math.max(p.y, 0), Math.max(0, vh - height))
      return x === p.x && y === p.y ? p : { x, y }
    }

    function UsagePanel() {
      const [data, setData] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [collapsed, setCollapsed] = React.useState(readCollapsed)
      const [pos, setPos] = React.useState(readPos)
      const [dragging, setDragging] = React.useState(false)
      const wrapRef = React.useRef(null)
      const suppressClick = React.useRef(false)

      function collapse() {
        writeCollapsed(true)
        setOpen(false)
        setCollapsed(true)
      }

      function expand() {
        writeCollapsed(false)
        setCollapsed(false)
      }

      // 拖拽状态条 / 收拢图标到任意位置。位移不超过阈值仍按点击处理,
      // 所以展开详情、收起、展开状态条这些点击行为都不受影响。
      function onPointerDown(e) {
        suppressClick.current = false
        if (e.button !== undefined && e.button !== 0) return
        const el = e.currentTarget
        const target = e.target
        if (!el || !target || !target.closest) return
        if (target.closest('button')) return
        // 展开态下 ⚡ 是纯点击目标(折叠开关),不参与拖拽;收拢后的图标仍可拖
        if (target.closest('.um-dot')) return
        if (!target.closest('.um-pill') && !target.closest('.um-mini')) return

        const rect = el.getBoundingClientRect()
        const doc = el.ownerDocument
        const drag = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          baseX: rect.left,
          baseY: rect.top,
          width: rect.width,
          height: rect.height,
          moved: false,
          last: null,
        }

        function viewport() {
          const root = doc.documentElement || {}
          return { vw: root.clientWidth || 0, vh: root.clientHeight || 0 }
        }

        function move(ev) {
          if (ev.pointerId !== drag.id) return
          const dx = ev.clientX - drag.startX
          const dy = ev.clientY - drag.startY
          if (!drag.moved) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
            drag.moved = true
            // 越过阈值才捕获指针:普通点击不重定向,拖拽时又能跟踪到窗口外
            if (el.setPointerCapture) { try { el.setPointerCapture(drag.id) } catch (err) {} }
            setDragging(true)
          }
          const vp = viewport()
          drag.last = clampPos({ x: drag.baseX + dx, y: drag.baseY + dy }, drag.width, drag.height, vp.vw, vp.vh)
          setPos(drag.last)
        }

        function finish() {
          doc.removeEventListener('pointermove', move)
          doc.removeEventListener('pointerup', finish)
          doc.removeEventListener('pointercancel', finish)
          if (drag.moved && el.releasePointerCapture) { try { el.releasePointerCapture(drag.id) } catch (err) {} }
          if (!drag.moved) return
          setDragging(false)
          suppressClick.current = true
          if (drag.last) writePos(drag.last)
        }

        doc.addEventListener('pointermove', move)
        doc.addEventListener('pointerup', finish)
        doc.addEventListener('pointercancel', finish)
      }

      function onBarClick() {
        if (suppressClick.current) { suppressClick.current = false; return }
        setOpen(!open)
      }

      function onMiniClick() {
        if (suppressClick.current) { suppressClick.current = false; return }
        expand()
      }

      // 视口尺寸变化后把保存的位置夹回可见范围
      React.useEffect(() => {
        const el = wrapRef.current
        const doc = el && el.ownerDocument
        const win = doc && doc.defaultView
        if (!el || !doc || !win || !win.addEventListener) return
        function fit() {
          const rect = el.getBoundingClientRect()
          const root = doc.documentElement || {}
          setPos((p) => (p ? clampPos(p, rect.width, rect.height, root.clientWidth || 0, root.clientHeight || 0) : p))
        }
        fit()
        win.addEventListener('resize', fit)
        return () => { win.removeEventListener('resize', fit) }
      }, [pos !== null])

      function load() {
        host.call('getUsage', {}).then((d) => setData(d)).catch(() => setData(null))
      }

      React.useEffect(() => {
        let stopInterval = null
        if (timer) stopInterval = timer.interval(load, 60000)
        load()
        return () => { if (stopInterval) stopInterval() }
      }, [])

      function shell(kids) {
        return React.createElement('div', {
          ref: wrapRef,
          className: 'um-wrap' + (pos ? ' um-placed' : '') + (dragging ? ' um-dragging' : ''),
          style: pos ? { left: pos.x + 'px', top: pos.y + 'px' } : null,
          onPointerDown: onPointerDown,
        }, kids)
      }

      // 折叠态:状态条收拢成一个圆形图标,点击图标再展开(图标同样可拖拽)
      if (collapsed) {
        return shell(React.createElement('span', {
          className: 'um-mini',
          onClick: onMiniClick,
          title: '拖拽移动 · 点击展开额度状态条',
        }, '⚡'))
      }

      function summarySeg(p, key) {
        const label = p.provider === 'command-code' && p.plan ? p.name + ' ' + p.plan : p.name
        const nm = React.createElement('span', { className: 'um-name' }, label + ' ')
        let val
        if (!p.ok) val = React.createElement('span', { className: 'um-err' }, '⚠')
        else if (p.kind === 'balance') val = React.createElement('span', { className: 'um-val' }, p.total + (p.currency || ''))
        else if (p.kind === 'usage') val = React.createElement('span', { className: 'um-val' }, '5h ' + fmtPct(p.rolling ? p.rolling.percent : null))
        return React.createElement('span', { key }, nm, val)
      }

      function detailBody(p) {
        if (!p.ok) return React.createElement('div', { className: 'um-err' }, '⚠ 获取失败')
        if (p.kind === 'balance') {
          return React.createElement('div', null,
            React.createElement('div', { className: 'um-row' }, React.createElement('span', { className: 'um-k' }, '剩余额度'), React.createElement('span', { className: 'um-v' }, p.total + ' ' + (p.currency || ''))),
            React.createElement('div', { className: 'um-row' }, React.createElement('span', { className: 'um-k' }, '充值余额'), React.createElement('span', { className: 'um-v' }, p.toppedUp + ' ' + (p.currency || ''))),
            React.createElement('div', { className: 'um-row' }, React.createElement('span', { className: 'um-k' }, '赠送余额'), React.createElement('span', { className: 'um-v' }, p.granted + ' ' + (p.currency || ''))),
          )
        }
        if (p.kind === 'usage') {
          // 统一格式(OpenCode Go / Command Code 同款):左侧「窗口名称 · 重置时间」,右侧百分比用量
          // 旧版 Host 只给 periodEnd + usagePercent 时在这里补出月窗口
          const monthly = p.monthly || (p.periodEnd ? { percent: p.usagePercent, resetsAt: p.periodEnd } : null)
          const win = (label, w) => React.createElement('div', { className: 'um-row', key: label },
            React.createElement('span', { className: 'um-k' }, label + ' · ' + (w && w.resetsAt ? fmtStamp(w.resetsAt) : '—')),
            React.createElement('span', { className: 'um-v' + (w && w.exceeded ? ' um-err' : '') }, fmtPct(w ? w.percent : null)))
          return React.createElement('div', null, win('5 小时', p.rolling), win('周', p.weekly), win('月', monthly))
        }
        return null
      }

      // ⚡ 既是标志也是折叠开关:点它收拢成图标,收拢后再点它展开。
      // 它在 pointerdown 就截断冒泡且不参与拖拽,所以不会被整条拖拽抢走点击。
      const dot = React.createElement('span', {
        className: 'um-dot',
        key: 'dot',
        title: '点击折叠为图标',
        onPointerDown: (e) => {
          // 这里截断了冒泡,wrap 的处理器收不到这次 pointerdown,
          // 所以要自己清掉"拖拽收尾 click"的抑制标志,否则拖拽之后的第一次点击会被吞掉
          suppressClick.current = false
          e.stopPropagation()
        },
        onClick: (e) => {
          e.stopPropagation()
          if (suppressClick.current) { suppressClick.current = false; return }
          collapse()
        },
      }, '⚡')

      const children = [dot]
      if (data && data.providers) {
        data.providers.forEach((p) => {
          children.push(summarySeg(p, 'seg-' + p.provider))
          children.push(React.createElement('span', { className: 'um-sep', key: 'sep-' + p.provider }, '·'))
        })
        if (data.providers.length > 0) children.pop()
      } else {
        children.push(React.createElement('span', { className: 'um-name', key: 'loading' }, '额度 …'))
      }

      const pill = React.createElement('span', { className: 'um-pill', onClick: onBarClick, title: '拖拽移动 · 点击展开详情' }, children)

      // 靠近视口上边缘 / 左边缘时把详情面板翻到另一侧,避免超出屏幕
      const panelCls = 'um-panel' + (pos && pos.y < 250 ? ' um-down' : '') + (pos && pos.x < 250 ? ' um-left' : '')

      let panel = null
      if (open) {
        const items = (data && data.providers ? data.providers : []).map((p) =>
          React.createElement('div', { className: 'um-item', key: p.provider },
            React.createElement('div', { className: 'um-title' }, (p.provider === 'deepseek-official' ? 'DeepSeek 官方' : p.provider === 'opencode-go' ? 'OpenCode Go' : p.provider === 'command-code' ? 'Command Code' + (p.plan ? ' ' + p.plan : '') : p.name)),
            detailBody(p),
          )
        )
        panel = React.createElement('div', { className: panelCls },
          React.createElement('div', { className: 'um-head' },
            React.createElement('span', { className: 'um-head-title' }, 'Provider 额度'),
            React.createElement('button', { className: 'um-close', onClick: () => setOpen(false), title: '关闭' }, '✕'),
          ),
          items,
        )
      }

      return shell([pill, panel])
    }

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'usage-meter', order: 100 },
      () => React.createElement(UsagePanel),
    ))
  },
}
