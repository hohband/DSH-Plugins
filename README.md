# DSH-Plugins

DeepSeek Harness (DSH) 插件集合。

## 插件

| 目录 | 说明 |
| --- | --- |
| [`usage-meter`](./usage-meter) | 右下角常驻胶囊显示 DeepSeek 官方 + OpenCode Go + Command Code(GOAT 订阅) 三个 provider 的余额/用量（persistent profile 插件 + dynamic 动态插件两形态） |

## 说明

本仓库保存三层源码：dynamic Cordis Plugin 的 Host / Client 两半（`dynamic/host.js` / `dynamic/client.js`）与持久化 profile 插件（`persistent/index.js` / `persistent/client.js`），
便于复用、审阅与在 DSH 中通过 `cordis_define` / `cordis_run` 重新装载。详见各插件目录的 README。
