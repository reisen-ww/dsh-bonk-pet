# bonk-pet 适配记录：DSH 0.2.0-rc.2

## 症状

DSH 启动即进恢复模式，网页里插件全不加载；随后宿主把 profile 配置重置
（`dsh.profile.bundles` 打回官方 2 项、patch 层被重写成默认模板，自定义模型配置一并丢失）。

崩溃日志 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log`：

```
app: @deepseek-ai/dsh-desktop 0.2.0-rc.2
Error: web boot: 1 entry did not activate
dsh-bonk-pet: pending (waiting for service: settingsScope)
```

同时 `error报告.txt` 记录：`duplicate loader entry id "bonk-pet" in the composed profile`。

## 根因（两条，都已修）

1. **服务被移除 + 声明式 inject 把整个前端 half 挂起。**
   新版 DSH 已删除 cordis 服务 `settingsScope`（在 121 MB 的 `app.asar` 里搜索
   `settingsScope` 命中 **0 次**）。而 `lib/client.js` 末尾写着
   `exports.inject = ['slots', 'settingsScope']` —— 声明式 inject 会让 Cordis
   **等所有服务就绪后才运行 apply**，服务不存在就永远 pending →
   启动判定失败 → 宿主重置 profile，把其它插件一起拖下水。
   （文件里 2380 行附近的注释本来就写明要用 `ctx.get` 而不是 inject，最后一行却
   自相矛盾地声明了 inject。）

2. **同一 entry 被插入两次。**
   旧配置把 bonk-pet 写在 profile 的 `cordis.patch.yml` 里 `insert`，而它自己的
   `package.json` 已有 `dsh.bundle.patch` → 组合树里出现两个 `id: bonk-pet`。

## 修复内容

- `lib/client.js`
  - `exports.inject = []`（不再 park 整个前端 half）
  - 服务改为防御式获取：`ctx.get('slots')` / `ctx.get('settingsScope')`；
    取不到就静默降级为"没有设置卡片"，宠物本体照常挂载
- profile `~/.dsh/profiles/desktop/package.json`
  - 插件**一律写进 `dsh.profile.bundles`**，不要再往 profile patch 里写 `insert`
    （`settingsScope` / patch insert 这两套旧做法都会在新版炸）

## 新版前端插件接口（0.2.0-rc.2 实测，来源 app.asar）

- 可用服务：`slots`、`locale`、`configForms`、`remote.*`（`remote.settings`、
  `remote.llm`、`remote.credentials`、`remote.session`、`remote.account`）、
  `theme`、`connection`、`shortcuts`、`settingsSchema`
- 设置页 slot：**`settings.plugins.tab`**（旧名 `settings.plugin.item` 已不存在）
- 设置作用域：`configForms.get(entryId)` → `ConfigFormController`
  （取代了旧的 `settingsScope.bind({ namespace })`）

## 未做 / 技术债

设置 → 插件里的三条音量滑块在 0.2.0-rc.2 上**暂时不显示**：新版用
`configForms.get(ns)` 返回的 `ConfigFormController`，与旧 `scope.getSnapshot() /
subscribe() / set()` 接口不同，要恢复滑块需要写一层适配。音量走默认值
音乐 65% / 钢管 34% / 敲盆 50%。

## 排查手法备忘

- 组合树离线校验（不需要重启）：`dsh --profile <影子profile> --dump-config`
  （`desktop` 归 Electron 独占管理，必须复制一份到自定义 profile 名再 dump）
- app.asar 可直接字节搜索 / 解析（8 字节 pickle 头 + JSON 目录），
  这是查"某个服务在新版是否还存在"最快的权威手段
