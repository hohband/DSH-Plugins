# Provider Usage Meter

在 DeepSeek Harness (DSH) 左侧菜单栏底部显示当前配置的两个 LLM provider 的余额与用量：

- **DeepSeek 官方** (`deepseek-official`)：账户剩余额度 / 充值余额 / 赠送余额（货币单位），数据来自 `GET https://api.deepseek.com/user/balance`。
- **OpenCode Go** (`opencode-go`)：滚动(5h) / 本周 / 本月 用量百分比，数据来自 `GET https://opencode.ai/zen/go/v1/usage`。

这是一个 **dynamic Cordis Plugin**（`cordis_define` / `cordis_run` 创建的运行时插件），运行时驻留在当前 DSH 进程内，不走磁盘持久化。本仓库保存其 Host / Client 两半源码，便于复用、审阅与重新装载。

## 交互

- 侧边栏底部（Settings 旁）显示一个 `⚡` 按钮 + 紧凑摘要（如 `9.36CNY · 2%`）。
- 点击展开面板，展示两个 provider 的详细数据，含手动「刷新」按钮。
- 每 60 秒自动刷新。

## 技术要点

- 动态插件 Host 沙箱会 trap `fetch`，`web.fetch` 又无法携带 `Authorization` header，且 opencode-go 的 usage 接口不允许 CORS，因此余额 / 用量查询走 **`subprocess` 服务 spawn `curl`** 携带 `Authorization: Bearer <key>`（不经过 shell 解释、无审批拦截）。
- API key 通过 `credentials.resolve('DEEPSEEK_API_KEY' / 'OPENCODE_GO_API_KEY')` 取用，**仅在 Host 侧使用**，RPC 返回值只含余额数字、不含 secret，绝不下发到浏览器。
- provider 显示名通过 `llm.listProviders()` / `llm.listConfigurableProviders()` 自动补全（兜底 `DeepSeek 官方` / `OpenCode Go`）。
- UI 注册在 `sidebar.footer.action`（增补型 list slot），不替换底层 SidebarRoot。

## 文件

- `host.js` — Host 半源码（`cordis_define` 的 `code.host` 函数体）。
- `client.js` — Client 半源码（`cordis_define` 的 `code.client` 函数体）。

## 重新装载

1. 打开 DSH，确认当前会话可访问 `credentials`（`DEEPSEEK_API_KEY`、`OPENCODE_GO_API_KEY`）。
2. 调用 `cordis_define`，将 `host.js` / `client.js` 的函数体分别填入 `code.host` / `code.client`。
3. `cordis_run` 激活（Client 端需在 UI 中批准）。
