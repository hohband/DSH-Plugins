# Provider Usage Meter

在 DeepSeek Harness (DSH) 右下角常驻显示三个 LLM provider 的余额与用量：

- **DeepSeek 官方** (`deepseek-official`)：账户剩余额度（货币单位），数据来自 `GET https://api.deepseek.com/user/balance`。
- **OpenCode Go** (`opencode-go`)：5 小时滚动窗口用量百分比，数据来自 `GET https://opencode.ai/zen/go/v1/usage`。
- **Command Code** (`command-code`)：GOAT 等订阅的用量（5 小时 / 周 / 月三个窗口的重置时间与用量百分比），数据来自 `GET https://api.commandcode.ai/alpha/billing/credits` 与 `GET https://api.commandcode.ai/alpha/billing/subscriptions`。

摘要胶囊示例：`⚡ DS 7.79CNY · OG 5h 10% · CC GOAT 5h 6.6%`。点击胶囊展开详情面板（DeepSeek 三项余额 + OpenCode Go 与 Command Code 各三行窗口：「5 小时」「周」「月」，每行 = 窗口名称 + 重置时间 + 百分比用量），「✕」关闭，每 60 秒自动刷新。

## 两种形态

| 目录 | 形态 | 说明 |
| --- | --- | --- |
| [`persistent/`](./persistent) | 持久化 profile 插件 | 跨 DSH 重启自动加载（推荐，见下） |
| [`dynamic/`](./dynamic) | 动态 Cordis 插件 | 进程内临时插件，重启即消失（`cordis_define`/`cordis_run`） |

## 持久化部署（persistent/）

持久化版是 DSH 的 out-of-tree profile 插件：一个本地 npm 包，Host 半注册 `/usage-meter` HTTP 接口（subprocess 跑 curl 查余额），Client 半注册 `shell.overlay` UI（浏览器同源 fetch 取数）。

### 安装步骤

1. 复制 `persistent/` 到 profile 目录：

   ```bash
   cp -R persistent ~/.dsh/profiles/web/usage-meter
   ```

2. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 添加：

   ```json
   { "usage-meter": "file:./usage-meter" }
   ```

3. 安装链接并注册插件行：

   ```bash
   cd ~/.dsh/profiles/web && pnpm install --offline
   ```

   在 `~/.dsh/profiles/web/cordis.patch.yml` 写入（注意必须用 `insert` 结构添加新条目）：

   ```yaml
   - insert:
       - id: usage-meter
         name: usage-meter
   ```

4. 重启 DSH（`--profile web`），右下角即出现额度胶囊。

### 技术要点

- 动态插件 Host 沙箱会 trap `fetch`、`web.fetch` 无 header 支持、opencode-go 不允许 CORS，因此数据查询走 **Host 端 subprocess 服务 spawn `curl`** 携带 `Authorization: Bearer`，subprocess 不可用时 fallback 到 shell 服务（key 经单引号转义，无 shell 注入）。
- API key 通过 `credentials.resolve('DEEPSEEK_API_KEY' / 'OPENCODE_GO_API_KEY' / 'COMMAND_CODE_API_KEY')` 取用，**仅在 Host 侧使用**，HTTP 接口只返回余额/用量数字，不含 secret。
- Command Code 的 `credits.monthlyCredits` 是**剩余**额度（倒扣），因此月度池子上限取 CLI 内置的套餐额度表（`individual-goat` = 70、`individual-go` = 10、`individual-pro` = 30 …，按 planId 最长前缀匹配）；`windowLimits.fiveHour` / `weekly` 的 `used`/`cap` 直接换算百分比。
- 两个 usage provider 在 Host 侧就统一成同一形状：`rolling` / `weekly` / `monthly` 三个 `{ percent, resetsAt, exceeded }` 窗口，因此 Client 只有一个 `kind === 'usage'` 渲染分支。OpenCode Go 直接用接口的 rolling/weekly/monthly；Command Code 的 5 小时与周取自 `windowLimits`，月窗口 = 额度池已用占比 + 订阅 `currentPeriodEnd`（旧版 Host 缺 `monthly` 时 Client 会用 `usagePercent` + `periodEnd` 兜底）。
- Host 半（`index.js`，ESM）:`inject: ['webServer', 'shell', 'subprocess']`，`ctx.effect` 注册 `/usage-meter` route（Node http API），subprocess/shell/credentials 通过 `ctx.get` 读取。
- Client 半（`client.js`）:预构建 bundle 格式 `window.__ModuleLoader__.load({ id, factory })`，`inject: ['slots', 'timer']`（由 `@deepseek-ai/dsh-client-ui-renderer` / `@deepseek-ai/dsh-cordis-client-runner` 提供，列在 `dsh.client.inject`），`react` 由 client module loader 内置提供。UI 注册在 `shell.overlay`（list 槽，kind 字段为 `id`/`order`/`label`），数据用同源 `fetch('/usage-meter')` 拉取。
- **改完代码如何生效**：Client 半由 client-modules 的 HMR 文件轮询（500ms）监听，落盘后 `/plugins/events` 会推送新的 `usage-meter` rev，浏览器自动/刷新即生效；Host 半走 Node 的 ESM 缓存，profile patch 热重载只重启 entry 而不会重新 import 模块，**必须重启 DSH 才会加载新的 `index.js`**（页面刷新、窗口 reload 都无效）。

### 动态装载（dynamic/）

`dynamic/host.js` 与 `dynamic/client.js` 是动态插件的 `code.host` / `code.client` 函数体，供 `cordis_define` / `cordis_run` 直接粘贴使用（受限沙箱 API：`harness.handle` / `host.call` / `styles.insert`）。
