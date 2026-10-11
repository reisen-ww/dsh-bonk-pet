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

## 滑块曾经不显示的真正根因（已修）

上面第 3 节早就查到"设置页 slot 是 `settings.plugins.tab`"，但 `lib/client.js`
当时注册的却是 `plugins.bundle.config` —— 一个**在内核里从头到尾不存在**的名字
（全 `app.asar` 搜索 0 命中）。于是三条滑块一直不出现。

**为什么代码没报错、探针还报绿？** 因为 `slots.inject(name, cb)` 对**未声明的
slot 不抛错**，只是把回调挂起等它出现。内核源码
`dsh-client-ui-renderer/lib/client.js`（`inject()` 的 `reconcile`）：

```js
const spec = this._core.specDynamic(key)
if (spec === void 0) return          // slot 未声明：静默 return，回调永不执行
const disposeEffect = ctx.effect(callback, ...)   // 已声明：同步立即执行
```

`try { slots.inject(...) } catch {}` 因此**永远抓不到问题**——`inject` 本身不会抛，
真正会抛的是回调里的 `slots.register`（`slot "X" is not declared (a parent entry's
children table must declare it)`），而回调压根没被调用。

当时那句 `bundleOk = true` 是**假阳性**，设置探针也因此报"registered"全绿，
但用户看到的是空的。

### 修复

- 注册目标改成内核真正声明、且专为第三方配置页准备的 seat：

  ```js
  contribute('settings.plugins.tab', {
    name: 'settings.plugins.tab', id: 'dsh-bonk-pet', order: 20,
    label: () => '敲盆宠物',
  })
  ```

  （该 slot 由官方 Plugins 页声明：`children: { 'settings.plugins.tab':
  { kind: 'list', scope: 'root' } }` —— `scope: 'root'` 就是给插件用的。）

- **成功与否在回调内部记录**，而不是在 `inject` 外面记：`outcome.registered` /
  `outcome.failed` 写进 `window.__bonkSettingsCard`，探针读它。

- 顺手删掉 `VolumeCard` 里 `if (props?.view === 'summary') return null`：
  那是为 `plugins.bundle.config` 的折叠列表准备的守卫，那个 slot 不存在，
  守卫的唯一效果是"静默什么都不渲染"——正是本次 bug 的同款模式。

- 探针 `test/probe-settings.js` 改成**走用户的真实路径**：打开设置 → 逐个点左侧
  导航 → 进「插件」页 → 点「敲盆宠物」标签页。之前它只去一级导航找，位置和用户
  不一致，所以测试通过而用户看不到。

- 音量仍走 `localStorage` + `POST /api/bonk-pet/volume`，**不需要 `configForms`**：
  卡片是自包含的，不依赖任何设置服务。

## 排查手法备忘

- **别信 `inject` 有没有抛错**：判断一个 slot 是否存在，只有两个可靠办法——
  ① 注册回调里记录结果；② 直接在 asar 里搜这个字面量。
- 组合树离线校验（不需要重启）：`dsh --profile <影子profile> --dump-config`
  （`desktop` 归 Electron 独占管理，必须复制一份到自定义 profile 名再 dump）
- app.asar 可直接字节搜索 / 解析（8 字节 pickle 头 + JSON 目录），
  这是查"某个服务在新版是否还存在"最快的权威手段
- 注意：npm 全局的 `dsh` CLI 是 **0.1.5-rc.1**，与桌面版 asar
  （**0.2.0-rc.2**）不是同一个版本，别拿 CLI 的现象推断桌面版行为
