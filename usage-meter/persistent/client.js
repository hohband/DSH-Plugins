// Client bundle of the persistent "usage-meter" plugin.
// Served by the host client-modules route as /plugins/usage-meter/client.js
// and materialized through window.__ModuleLoader__.load.

window.__ModuleLoader__.load({
  id: "usage-meter",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    const React = require("react")

    const inject = ["slots", "timer"]
    const name = "usage-meter"

    const CSS = `
      .um-wrap { position: fixed; right: 8px; bottom: 8px; z-index: 9000; }
      .um-pill { display: inline-flex; align-items: center; gap: 8px; background: rgba(24,25,30,.92); border: 1px solid #2c2d33; border-radius: 8px; padding: 4px 10px; font-size: 11px; line-height: 1.4; color: #cfcfd6; white-space: nowrap; box-shadow: 0 4px 16px rgba(0,0,0,.35); font-variant-numeric: tabular-nums; cursor: pointer; pointer-events: auto; }
      .um-dot { color: #ffd166; }
      .um-sep { color: #3a3b42; }
      .um-name { color: #8a8a93; }
      .um-val { color: #e6e6e6; }
      .um-err { color: #f87171; }
      .um-panel { position: fixed; right: 8px; bottom: 40px; z-index: 9000; background: #1e1f24; border: 1px solid #2c2d33; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); padding: 10px 12px; font-size: 12px; color: #e6e6e6; width: 240px; pointer-events: auto; }
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
    `

    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement("style")
        tag.dataset.plugin = "usage-meter"
        tag.textContent = CSS
        document.head.append(tag)
        return () => { tag.remove() }
      }, "usage-meter: styles")

      function UsagePanel() {
        const [data, setData] = React.useState(null)
        const [open, setOpen] = React.useState(false)

        function load() {
          fetch("/usage-meter")
            .then((r) => r.json())
            .then((d) => setData(d))
            .catch(() => setData(null))
        }

        React.useEffect(() => {
          const stop = ctx.timer.interval(load, 60000)
          load()
          return () => { stop() }
        }, [])

        function summarySeg(p) {
          const nm = React.createElement("span", { className: "um-name" }, p.name + " ")
          let val
          if (!p.ok) val = React.createElement("span", { className: "um-err" }, "⚠")
          else if (p.kind === "balance") val = React.createElement("span", { className: "um-val" }, p.total + (p.currency || ""))
          else if (p.kind === "usage") val = React.createElement("span", { className: "um-val" }, "5h " + (p.rolling ? p.rolling.percent + "%" : "—"))
          return React.createElement("span", null, nm, val)
        }

        function detailBody(p) {
          if (!p.ok) return React.createElement("div", { className: "um-err" }, "⚠ 获取失败")
          if (p.kind === "balance") {
            return React.createElement("div", null,
              React.createElement("div", { className: "um-row" }, React.createElement("span", { className: "um-k" }, "剩余额度"), React.createElement("span", { className: "um-v" }, p.total + " " + (p.currency || ""))),
              React.createElement("div", { className: "um-row" }, React.createElement("span", { className: "um-k" }, "充值余额"), React.createElement("span", { className: "um-v" }, p.toppedUp + " " + (p.currency || ""))),
              React.createElement("div", { className: "um-row" }, React.createElement("span", { className: "um-k" }, "赠送余额"), React.createElement("span", { className: "um-v" }, p.granted + " " + (p.currency || ""))),
            )
          }
          if (p.kind === "usage") {
            const rows = []
            const add = (label, u) => { if (u) rows.push(React.createElement("div", { className: "um-row" }, React.createElement("span", { className: "um-k" }, label), React.createElement("span", { className: "um-v" }, u.percent + "%"))) }
            add("滚动(5小时)", p.rolling); add("本周", p.weekly); add("本月", p.monthly)
            if (rows.length === 0) rows.push(React.createElement("div", null, "无数据"))
            return React.createElement("div", null, rows)
          }
          return null
        }

        const children = [React.createElement("span", { className: "um-dot", key: "dot" }, "⚡")]
        if (data && data.providers) {
          data.providers.forEach((p) => {
            children.push(summarySeg(p))
            children.push(React.createElement("span", { className: "um-sep", key: "sep-" + p.provider }, "·"))
          })
          children.pop()
        } else {
          children.push(React.createElement("span", { className: "um-name", key: "loading" }, "额度 …"))
        }

        const pill = React.createElement("span", { className: "um-pill", onClick: () => setOpen(!open), title: "点击展开详情" }, children)

        let panel = null
        if (open) {
          const items = (data && data.providers ? data.providers : []).map((p) =>
            React.createElement("div", { className: "um-item", key: p.provider },
              React.createElement("div", { className: "um-title" }, (p.name === "DS" ? "DeepSeek 官方" : p.name === "OG" ? "OpenCode Go" : p.name)),
              detailBody(p),
            )
          )
          panel = React.createElement("div", { className: "um-panel" },
            React.createElement("div", { className: "um-head" },
              React.createElement("span", { className: "um-head-title" }, "Provider 额度"),
              React.createElement("button", { className: "um-close", onClick: () => setOpen(false), title: "关闭" }, "✕"),
            ),
            items,
          )
        }

        return React.createElement("div", { className: "um-wrap" }, pill, panel)
      }

      ctx.slots.inject("shell.overlay", function* () {
        yield ctx.slots.register(
          { name: "shell.overlay", id: "usage-meter", order: 100 },
          () => React.createElement(UsagePanel),
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  }
})
