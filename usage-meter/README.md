# Provider Usage Meter

在 DeepSeek Harness (DSH) 右下角常驻显示两个 LLM provider 的余额与用量：

- **DeepSeek 官方** (`deepseek-official`)：账户剩余额度（货币单位），数据来自 `GET https://api.deepseek.com/user/balance`。
- **OpenCode Go** (`opencode-go`)：5 小时滚动窗口用量百分比，数据来自 `GET https://opencode.ai/zen/go/v1/usage`。

摘要胶囊示例：`⚡ DS 7.79CNY · OG 5h 10%`。点击胶囊展开详情面板（DeepSeek 三项余额 + OpenCode 滚动/本周/本月），「✕」关闭，每 60 秒自动刷新。

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

- 动态插件 Host 沙箱会 trap `fetch`、`web.fetch` 无 header 支持、opencode-go 不允许 CORS，因此数据查询必须走 **Host 端 subprocess 服务 spawn `curl`** 携带 `Authorization: Bearer`。
- API key 通过 `credentials.resolve('DEEPSEEK_API_KEY' / 'OPENCODE_GO_API_KEY')` 取用，**仅在 Host 侧使用**，HTTP 接口只返回余额数字，不含 secret。
- Host 半（`index.js`，ESM）:`inject: ['webServer']`，`ctx.effect` 注册 `/usage-meter` route（Node http API），subprocess/credentials 通过 `ctx.get` 读取。
- Client 半（`client.js`）:预构建 bundle 格式 `window.__ModuleLoader__.load({ id, factory })`，`inject: ['slots', 'timer']`（由 `@deepseek-ai/dsh-client-runtime` / `@deepseek-ai/dsh-cordis-client-runner` 提供，列在 `dsh.client.inject`），`react` 由 client module loader 内置提供。UI 注册在 `shell.overlay`，数据用同源 `fetch('/usage-meter')` 拉取。

### 动态装载（dynamic/）

`dynamic/host.js` 与 `dynamic/client.js` 是动态插件的 `code.host` / `code.client` 函数体，供 `cordis_define` / `cordis_run` 直接粘贴使用（受限沙箱 API：`harness.handle` / `host.call` / `styles.insert`）。
