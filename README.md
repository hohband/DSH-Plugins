# DSH-Plugins

DeepSeek Harness (DSH) 插件集合。

## 插件

| 目录 | 说明 |
| --- | --- |
| [`usage-meter`](./usage-meter) | 左侧菜单栏显示 DeepSeek 官方 + OpenCode Go 两个 provider 的余额/用量（动态 Cordis 插件） |

## 说明

本仓库保存 dynamic Cordis Plugin 的 Host / Client 两半源码（`host.js` / `client.js`），
便于复用、审阅与在 DSH 中通过 `cordis_define` / `cordis_run` 重新装载。详见各插件目录的 README。
