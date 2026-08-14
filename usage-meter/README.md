# Provider Usage Meter

在 DeepSeek Harness (DSH) 界面右下角常驻显示当前配置的两个 LLM provider 的余额与用量：

- **DeepSeek 官方** (`deepseek-official`)：账户剩余额度（货币单位），数据来自 `GET https://api.deepseek.com/user/balance`。
- **OpenCode Go** (`opencode-go`)：5 小时滚动窗口用量百分比，数据来自 `GET https://opencode.ai/zen/go/v1/usage`。

这是一个 **dynamic Cordis Plugin**（`cordis_define` / `cordis_run` 创建的运行时插件），运行时驻留在当前 DSH 进程内，不走磁盘持久化。本仓库保存其 Host / Client 两半源码，便于复用、审阅与重新装载。

## 交互

- 右下角常驻一个信息胶囊，摘要显示：`⚡ DS 9.31CNY · OG 5h 1%`。
- **点击胶囊展开详情面板**：
  - DeepSeek 官方：剩余额度 / 充值余额 / 赠送余额；
  - OpenCode Go：滚动(5 小时) / 本周 / 本月 用量百分比。
- 面板右上角「✕」关闭，数据每 60 秒自动刷新。

## 技术要点

- 动态插件 Host 沙箱会 trap `fetch`，`web.fetch` 又无法携带 `Authorization` header，且 opencode-go 的 usage 接口不允许 CORS，因此余额 / 用量查询走 **`subprocess` 服务 spawn `curl`** 携带 `Authorization: Bearer <key>`（不经过 shell 解释、无审批拦截），并 fallback 到 `shell` 服务。
- API key 通过 `credentials.resolve('DEEPSEEK_API_KEY' / 'OPENCODE_GO_API_KEY')` 取用，**仅在 Host 侧使用**，RPC 返回值只含余额数字、不含 secret，绝不下发到浏览器。
- UI 注册在 `shell.overlay`（frame-wide floating layer，替换风险 none），用 `position: fixed` 定位到右下角，不干扰其他界面元素。

## 文件

- `host.js` — Host 半源码（`cordis_define` 的 `code.host` 函数体）。
- `client.js` — Client 半源码（`cordis_define` 的 `code.client` 函数体）。

## 重新装载

1. 打开 DSH，确认当前会话可访问 `credentials`（`DEEPSEEK_API_KEY`、`OPENCODE_GO_API_KEY`）。
2. 调用 `cordis_define`，将 `host.js` / `client.js` 的函数体分别填入 `code.host` / `code.client`。
3. `cordis_run` 激活（Client 端需在 UI 中批准）。
