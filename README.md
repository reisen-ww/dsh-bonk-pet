# dsh-bonk-pet 🔧🐋

> 敲盆宠物 — DSH Web GUI 的悬浮小鲸鱼。
> **干活的唱歌；出错就掉钢管砸它；你可以敲它的铁盆；敲完它会跑去讨白饭吃。**

---

## 它是什么

一只住在 DSH Web 界面右下角、坐在一只旧铁盆里的小鲸鱼。

| 什么时候 | 它会怎样 |
|---|---|
| **agent 开始干活** | 摇摆身体**唱歌**，头顶飘音符 ♪♫，**并轮流出中英文歌词**（放歌见下文） |
| **任务结束** | 停止唱歌，安静下来 |
| **agent 执行出错**（工具失败 / 回合失败） | 天上掉下一根钢管，砸它头上，它被压扁、冒星星、喊疼 |
| **你点它的铁盆** | 盆和它一起抖，冒一句台词（「别敲了！」「在跑了在跑了」） |
| **你连敲 3 下** | 饿了就跑出去找吃的，桌上**随机位置**冒出一坨白饭 |
| **饭出现了** | 它看见了，**咻一下冲过去**自己吃掉（不用你点） |
| **你连敲 6 下** | 开始阴阳你：「你还敲上瘾了是吧」 |
| **饿了（饱食度见底）** | 无精打采地晃，喊饿 |
| **闲着的时候** | 每 25 秒掷一次骰子，饿了就有几率自己去找饭吃 |

敲盆会**消耗它的饱食度**（敲一下 -12）。所以敲得越狠，它越饿，越要出去找饭。
——这是设计上的闭环：**你的不耐烦会变成它的饥饿**。

---

## 放歌 & 换形象

两样东西都丢进 **`~/.dsh/bonk-pet/`**，然后刷新页面。

```powershell
# 放歌（文件名带 letmego 的优先）
copy 你的歌.mp3 "$env:USERPROFILE\.dsh\bonk-pet\letmego.mp3"

# 换形象（把你自己生成的图命名为 pet.png）
copy 你生成的宠物图.png "$env:USERPROFILE\.dsh\bonk-pet\pet.png"
```

## 放素材：`~/.dsh/bonk-pet/`

**四个槽位，全部可选，互相独立。** 缺哪个就用代码画的那个。

> 插件启动时还会在这个目录写一个 **`loaded.txt`** —— 那是它的"到岗打卡"，
> 记着挂载时间、PID 和启动命令。**别删**，它是唯一能证明插件真的加载了的
> 证据（见下面"装完必须重启"）。它不会被当成歌或音效（`.txt` 不在白名单里）。

| 文件名 | 是什么 | 缺省表现 |
|---|---|---|
| `letmego.mp3`（或任何带 `letmego` 的音频） | 干活时唱的歌 | 安静地干活 |
| `敲盆.mp3` | 敲盆音效 | 无声，但照样抖动+冒台词 |
| `钢管落地.mp3` | 钢管砸中音效 | 无声，但照样掉钢管 |
| `pet.png` | **宠物本体**（可以自带铁盆） | 用代码画的鲸鱼 |
| `basin.png` | **单独的**铁盆（可选） | 见下方"铁盆规则" |
| `pipe.png` | 钢管 | 用代码画的钢管 |
| `rice.png` | 桌上那坨白饭（**随机位置出现，宠物冲过去吃**） | 用代码画的饭团 |

格式：图片认 `.png` / `.webp` / `.jpg` / `.jpeg` / `.gif` / `.svg`；
音频认 `.mp3` / `.m4a` / `.aac` / `.ogg` / `.opus` / `.wav` / `.flac` / `.webm`。

换任何东西都**不用改代码、不用重装插件**，丢文件进去刷新页面即可。

### 铁盆规则（重要）

铁盆有**两种摆法**，靠你放不放 `basin.png` 来选：

| 你放了什么 | 效果 |
|---|---|
| `pet.png`（**图里已经含盆**）+ 不放 `basin.png` | 用你图里的盆，**代码画的盆隐藏**，点**整只宠物**都是敲盆 ← **你现在是这种** |
| `pet.png`（**纯宠物，不含盆**）+ `basin.png` | 两层叠加，盆会**单独抖动**，可以单独点 |
| 只放 `pet.png`（纯宠物）+ 不放 `basin.png` | ⚠️ **代码画的盆也会隐藏**（因为无从判断你图里有没有盆） |
| 什么都不放 | 用代码画的鲸鱼 + 代码画的盆 |

> 如果你要放**纯宠物的图**，请**同时**放一张 `basin.png`，否则盆不会画出来。

### 图片要求

- **透明底 PNG**（不要白底——会变成一个白方块贴上去）
- **正方形或接近正方形**，宠物居中，四周留点空隙
- 图里的宠物**自带盆**时，构图要让盆在下方、完整可见

### 歌

- 文件名带 **`letmego`** 的会被优先选中
- **第一次会被浏览器拦截**，宠物脚下出现「🔇 点我开声音」按钮，点一下就好，
  之后会记住（存在 localStorage）
- 音效文件会被**自动从歌单里剔除**，不会被当成背景音乐轮播

> **为什么不能直接指定路径**：DSH 的客户端插件（浏览器里那一半）**没有加载外部文件的能力** ——
> `dsh.client` 只认 `platform` / `inject` / `external` / `immediately` 四个字段，没有静态资源目录，
> 所有官方客户端插件都是把素材 base64 内嵌的。所以换了个思路：歌和图都由**宿主端**（Node 那一半）
> 读，通过一条只读路由喂给浏览器。

### 关于默认形象

`image_gen` 后端一直 `auth_failed`（外部依赖挂了），所以默认形象是**代码画的 SVG 鲸鱼**，
另外留了上面那些槽位让你自己放图。你放的图**已验证可用**（找到 → 替换 → 真实解码都测过）。

---

## 想先看效果（不用装、不用重启）

```bash
node tools/serve-demo.js
```

然后浏览器打开 **http://127.0.0.1:43900/**

它会读你 `~/.dsh/bonk-pet/` 里的**真实素材**，用**同一个客户端 bundle** 渲染，
并且真的提供 `/api/bonk-pet/*` 那三条路由。所以你看到的形象、歌、音效
就是装好之后的样子。页面上有按钮可以手动触发「开始任务」「执行出错」「敲盆」。

**唯一缺的是 DSH 的事件流** —— 真实界面里 agent 一干活它自动唱、一出错自动掉钢管，
这里得手动点。

> 直接双击 `demo.html` 也能打开，但浏览器不给本地网页读别的目录，
> 所以那样只能看到代码画的默认形象，也没有声音。
> 要看自己的素材，用上面那条命令。

---

## 装法

```bash
dsh plugin --profile <你的 profile> add <本目录路径或 git 地址>
```

> ⚠️ `desktop` profile 被 DSH CLI 硬性拒绝（`bin.js` 里 `rejectElectronProfile`）。
> 给 Desktop 装的话，在 profile 目录 `pnpm add <路径>`，
> 然后往 profile 的 `package.json` 的 `dsh.profile.bundles` **或** `cordis.patch.yml` 里加一行（二选一，别同时加）：

```yaml
# cordis.patch.yml（推荐：patchReload 是 live，改完不用重启）
- insert:
    - id: bonk-pet
      name: 'dsh-bonk-pet'
```

### 装完要重启 —— 但先试一下市场开关

这一条我**前后改了两次结论**，把两次都写下来，因为过程比结论有用。

**先说事实**（都在独立实例上实测过）：

| 做法 | `dsh web` 上 | Desktop(Electron) 上 |
|---|---|---|
| 运行中改 `cordis.patch.yml` | **有效**（路由 404 → 等 20 秒 → 200） | 改完等 30 秒**无反应** |
| 市场里的启用开关（`hotMount`） | **有效，且功能完整**（见下） | 未验证（机制相同，但没在你的宿主上按过） |

**市场开关那条路我验得很彻底**：起了个 patch 层为空的实例（插件只能靠市场挂载），
调用 toggle 之后——`{"ok":true,"live":["dsh-bonk-pet"],"hot":true,"restart":false}`，
然后跑完整套：

- 端到端 **55/55 通过**（含四种失败各掉一次钢管、点击敲盆、素材加载）
- 玩法链路 **9/9 通过**（敲→饿→讨饭→出满碗→喂食→存档）

也就是说**市场挂载出来的插件和正常加载的功能完全一样** —— 它走的是 `mkt-` 前缀的
`Include` 子树，跟 bundle 层是不同的机制，我原本不确定会不会有差异，实测没有。

**为什么 web 上有效、Desktop 上没反应**：两者走**不同的启动代码**。

- `dsh web` 走 `dsh/lib/profile-boot-*.js`，里面有 `watchUserPatches` —— 它注册 Cordis
  HMR 的 `registerConfig(filename, ...)` 来监听 patch 文件。
- DSH Desktop 走 `lib/profile-pZhrTizp.js`，里面**只有 `patchReload` 配置读取，没有
  `watchUserPatches`** —— 它读 patch，但不监听 patch。

**所以顺序建议**：

1. **先试市场里的启用开关** —— 它调 `hotMount()`，跟 watcher 无关，
   是唯一可能让 Desktop 免重启的路。日志看
   `<profile>/.dsh-market/log.ndjson`，成功会写
   `hotMount ... live` 或 `hot-mount ... live`。
2. 开关不行就**重启一次**。重启之后改代码、换素材都不再需要重启
   （客户端资源每次请求都重读）。

**怎么确认它真的加载了**：

```bash
node tools/check-live.js
```

它读 `~/.dsh/bonk-pet/loaded.txt`（插件自己写的到岗打卡，记着挂载时间/PID/启动命令）。
**别用 HTTP 探测判断** —— Desktop 的渲染器栅栏对外一律回 403，
分不清"路由不存在"和"被挡住"，这是这个工具不拿状态码当结论的原因。

> **一个我踩过的坑，值得记下来**：我最早判断"patch 热重载无效"，是因为我的
> 测试 profile 里**插件根本没装进 `node_modules`**（我只写了 `package.json` 的依赖，
> 没真装包）。patch 行解析不到包 → 静默失败。我把"包找不到"错当成了"热重载不生效"。
> 后来补齐 `node_modules` 再测，就 404→200 了。**结论错了不可怕，不查清楚原因才可怕。**

> 附带一个坑：`profiles/<名字>/package.json` **不能有 BOM**。
> PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会加 BOM，导致
> `readProfileManifest` 报 `Unexpected token ''`。用 `.NET` 的
> `UTF8Encoding($false)` 写，或者直接用编辑器存成"无 BOM 的 UTF-8"。

### 关于市场的「重启」按钮

> **这一条是代码分析，不是实测** —— 我没有在 Desktop 上按过它。

`dshmarket` 带一个自重启功能（`lib/restart.js`，"Self-restart: relaunch the exact
DSH invocation that booted this host"）。它靠 `dshArgv()` 复原启动命令，而那个函数
只在 `process.argv[1]` 匹配 `bin.js` 时才走 Node 路径；否则退回 `file: 'dsh'`，
靠 `.cmd` shim 启动**一个独立的 dsh 进程**。

Desktop 跑的是 Electron，`process.argv[1]` 不是 `bin.js`，所以按代码它可能去起一个
**不含 `--profile desktop`** 的普通实例 —— 而 `desktop` profile 恰恰被 CLI
硬性拒绝（`rejectElectronProfile`）。

**要重启还是用 DSH 自己的方式**（关窗口重开）最稳妥。

> 但**启用/停用插件的开关是另一回事**，那个走 `hotMount()`，见上一节 ——
> 值得先试。

---

## 它怎么知道在干活 / 出错了

宿主端（`lib/index.js`）订阅 harness 的三个信号：

| 信号 | 事件 | 判据 |
|---|---|---|
| 开始/结束干活 | `agent/status` | `status` 是 `running` 还是 `idle` |
| 工具调用失败 | `tools/result` | `result.isError === true` |
| 回合/步骤失败 | `agent/error` | 事件到达即失败 |

然后通过 **SSE 路由** `/api/bonk-pet/events` 推给浏览器。

**为什么用自建 SSE 而不是官方通道**：官方的 host→client 事件转发有一张**硬编码的 19 项白名单**
（`dsh-api-remotes/lib/types/remote-events.js`），第三方插件注册不了新事件名；
而宿主插件可以自己 `ctx.webServer.register()` 一条路由。这条路不依赖修改官方包。

### 只读了什么

转发出去的只有 `{ type, kind, tool?, message, at }`，其中 `message` 被截断到 200 字符。
**不转发任何对话内容、工具参数或凭据。** 路由只监听、从不接受写入。

### 四条路由

| 路由 | 作用 |
|---|---|
| `/api/bonk-pet/events` | SSE 事件流（干活状态 + 出错）；**订阅时会补发当前状态**，断线重连不会哑掉 |
| `/api/bonk-pet/tracks` | 列出音频，**并把音效从歌单里分出来**（`{tracks, effects}`） |
| `/api/bonk-pet/asset?name=x.mp3` | 流式送出该目录里的一个文件（音频或图片） |
| `/api/bonk-pet/skin` | 告诉你四个素材槽各有没有文件（`{slots}`） |

资源路由**只服务那一个目录**。防线有两层：

1. 文件名白名单：拒绝带 `/`、`\`、`..`、`.` 开头、超过 128 字符的名字；
2. **`realpath` 复核**：解析真实路径后再确认仍在目录内 —— 否则目录里的
   一个符号链接（路径看着在目录内，实际指向外面）就能读走目录外的文件。

两层都有测试覆盖。

---

## 为什么歌词不对轴（以及那个"抽搐"的真相）

### 歌词：不做时间轴，是**查过之后的选择**

`tools/read-song.js` 把歌文件拆开看过：

```
TIT2 : Let Me Go(共创版)      ← "共创版" = AI 协作生成，不是公开发行
TALB : 肥鱼罐头
TPE1 : 罐装毕加索
SYLT : ABSENT   ← 文件里没有同步歌词
USLT : ABSENT   ← 也没有纯文本歌词
时长 : 2分04秒（320kbps / 48kHz / mono，CBR）
```

`COMM` 帧里带一个 **`163 key`**，是网易云音乐的标记。

**结论**：这是一首私有共创曲目，网上不存在别人做好的时间轴；文件本身也没带。
继续找是浪费时间，所以改成**定时轮流出歌词**（`SING_EVERY_MS = 6500`），
中英交替——正好复现原曲 call-and-response 的结构。

**如果哪天你拿到了真时间轴**，那是这件事的升级版，不是推倒重来：
把 `singLine()` 从 `setInterval` 换成"按 `audio.currentTime` 查表"即可。

### 抽搐：两个症状，一个根因

你先后报了两次"抽搐"——**吃完饭闪一下**、**松开拖动抖一下**。
它们不是两个 bug，是同一个：

`root.left/top` **没有过渡**，`transform` **有过渡**。同一帧里改这两个，
宠物被**算了两遍位移**，然后一起过渡回去。

| 触发 | 修复前最大偏移 | 修复后 |
|---|---|---|
| 吃完饭 | 389px | 19px（静止量） |
| 松开拖动 | 253px | **0px** |

修法：抽出 `commitPosition()` 一处提交，先 `data-settling="1"` 关掉 transform
过渡、强制回流、再恢复。两个调用点共用，不再各写一遍。

> **一条更值钱的教训**：我第一版拖动探针是**瞎的** —— 它量 `root` 的 rect，
> 而 transform 在子元素上，根本量不到。我做了**敏感度检验**（故意禁用修复），
> 探针依然报 0px，才发现。改成量 `whale` 后：禁用=253px、启用=1px。
>
> **一个永远通过的测试比没有测试更危险。** 所以 `probe-drag.js` 现在跑 4 次
> 都是 0px，而它在修复被禁用时必然失败 —— 这条双向验证过。

---

音量滑块住在 **设置 → 插件 → 插件配置** 里，但这一小块 UI 牵出了三个独立的坑，
每一个都会让卡片**静默消失**（代码里所有失败路径都是 `return`，不报错）：

### 坑 1：Cordis 服务必须声明，否则读属性直接抛错

```
cannot get property "slots" without inject
```

`slots` 是 Cordis 服务。声明的地方是**客户端 bundle 的
`inject` 导出**：

```js
exports.inject = ['slots']   // 服务名，不是包名
exports.apply = apply
```

只声明**确实存在**的服务。早先这里多写了一个 `settingsScope`（内核已删除的服务），
结果是整个前端 half 永远 pending（启动日志 `1 entry did not activate`），
宿主判定启动失败后把 profile 重置，其它插件一起遭殃。**声明式 `inject` 里写一个
不存在的服务，不是"降级"，是自杀。**

踩错的地方：`package.json` 里的 `dsh.client.inject` **不是这个**，
它装的是**包名**（模块图的排序边），填了没用。已经装好的第三方插件
（`dsh-better-reasoning-effort`）就是这么写的，去读它的 bundle 才确认下来。

> 声明 `inject` 会让 Cordis **等**服务出现才跑 `apply`。这两个服务由
> `dsh-client-ui-renderer` 提供，web profile 里必然存在，所以不会把宠物卡死。

### 坑 2：`ctx.get('slots')` 绕不过去

试过用 `ctx.get` 做"可选查找"，同样报 `without inject`。这条路不通。

### 坑 3：符号链接 + `node_modules`（见上面「环境陷阱」）

设置 schema 要 `@deepseek-ai/schemastery`。插件是符号链接装的，Node 取 realpath
后从源码目录向上找不到 `node_modules`，`import` 失败 → schema 返回 `null` →
命名空间压根没注册 → 卡片不出现。用 junction 补上就好。

### 怎么确认它真的能用

`node test/probe-settings.js <origin> <token>` —— 它会**真的打开设置面板**、
找到插件页签、断言三条滑块渲染出来，然后**拖一下钢管滑块**，
回头查 `/api/bonk-pet/volume` 是不是真的变了。

量到过：`slider=0.34 → host reported pipe=0.05`。

> 为什么值得专门写探针：卡片是注册到**别人的** slot 里的，
> "插件说它注册了" 和 "用户能看见" 是两回事。只有打开面板才算证明。

---

## 什么情况下会掉钢管

宿主端订阅了**全部四个**失败信号（早期版本只挂了两条，漏掉的正是最常发生的那条）：

| 信号 | 事件 | 宠物说的话 |
|---|---|---|
| 工具调用失败 | `tools/result` 且 `isError` | `工具 pwsh 挂了：TOOL_TIMEOUT` |
| **模型请求失败** | `agent/request-error` | `deepseek 请求失败：rate limited` |
| 会话级失败 | `api-session/error` | `会话出错：credentials rejected` |
| 回合失败 | `agent/error` | `回合失败（第 3 回合 · 第 7 步）：boom` |

> **`agent/request-error` 是 waterfall 事件。** `@deepseek-ai/dsh-llm-retry`
> 也在监听它来决定要不要重试，靠调用 `next()` 把链子传下去。
> 本插件只观察、不干预，看完立刻 `next()` —— 否则会**悄悄禁掉重试**，
> 那比少一个动画严重得多。有专门的测试盯着这一点。

**仍然抓不到的**：模型输出的**格式/转义错误**。它不经过上面任何一个事件
（要抓得改 harness 层）。这是已知限制，不是遗漏。

---

## 两轮独立审查（以及它们教我的事）

插件做过两轮**只读**审查：一轮查浏览器端，一轮查宿主端。两轮都明确标注了
"确定"与"疑似"，也都**证伪了自己的部分假设**——这比找到 bug 更有价值
（比如"孤儿定时器"和"dash 途中敲盆"两条都被实验推翻，不该去修）。

### 找到并修掉的

| # | 症状 | 根因 |
|---|---|---|
| 1 | **每次工具失败都只说"工具执行失败"** | 真实形状是 `error.info.code`，代码读的 `error.code` 永远读不到 |
| 2 | **拖到角落宠物一半在屏幕外**，刷新也回不来 | clamp 上界 60px，而元素 150px |
| 3 | 窗口缩小后宠物留在视野外 | 完全没有 resize 处理 |
| 4 | 设置改完重载会泄漏 | `watch()` 返回**函数**，不是 `{dispose()}` |
| 5 | 存档被改坏 → 宠物永久饥饿 | `clamp` 不挡 `NaN`，一路扩散 |
| 6 | 断线退避多算一次 | `attempts` 在请求前自增，第 5 次排了个永不用的定时器 |
| 7 | `/skin` 一次失败 → **两个盆**，整页不恢复 | 一次性探测，兄弟探针都容错只有它没有 |
| 8 | `serve-demo.js` 注释谎称"不会漂移" | 它根本没 import 宿主代码，且已漂移 5 处 |

### 教训一：**测试是绿的，bug 是真的**

第 1 条**测试通过**——因为 fixture 用了**真实管线永远不会产生的形状**
（`error: { code }`）。测试不但没抓到，还**把 bug 固化了**。

修法：fixture 换成真实形状，并补两条覆盖其他真实分支（只有 `message` 的守卫拒绝、
什么都没有的退化 payload）。现在 **52 项单测**。

### 教训二：**测试自己坏掉，会被误读成产品回归**

改完文案 E2E 挂了，看着像回归。查出两个都是**测试的问题**：

1. e2e 里**硬编码了一份台词副本**——改文案就改过期了。
   现在两边共用 `tools/parse-lines.js` 一个解析器。
2. 断言盯 `data-state`，而那是**所有动画共用的一个槽位**。测试期间宿主真的
   发来一个错误（profile 里旧 session `resume failed`），宠物**正确地**掉了钢管，
   状态被覆盖成 `hit`。现在改盯**敲盆计数器**（按原因分开，不受干扰）。
   同一个坑也让 `tool` 那条断言改盯**台词**而不是状态——台词是持久的，
   `hit` 只有 1500ms。

### 教训三：**"永远通过"的探针比没有探针更危险**

两个探针各有一个永远通过的问题，都是靠**敏感度检验**（故意禁用修复，看它会不会失败）
才发现的：

- `probe-drag.js` 量错了元素（量 `root`，而 transform 在子元素上，量不到）
- `probe-dash.js` 只断言"移动了 >60px"（饭在屏幕外时照样通过）

**修完之后都做了双向验证**：禁用修复 → 253px / 781px 失败；启用 → 0px 通过。

---

### 单元测试（不需要 DSH、不需要浏览器）

```bash
node test/run.js
```

**50 项**，自带 DOM stub。覆盖：SSE 路由注册与响应头、成功结果不误报、
**四个失败信号各推一帧**、**回合失败带上"第几回合第几步"**、
**重试链必须被传下去而不是吞掉**、超长消息截断、死 socket 不炸掉工具流水线、
卸载时关闭所有流、状态广播、未知状态忽略、
**多 agent 时的状态聚合**（子 agent 结束不会打断主 agent 的歌；缺 `agent` 字段时退回简单转发）、
资源路由的**目录穿越/超长名/非法扩展名/缺失文件**、
**符号链接逃逸**（目录内指向目录外的链接必须 404）、
素材探测在没图时返回空槽表、曲目列表在无目录时也能应答、**音效不被算进歌单**；
客户端的挂载、样式只注入一次、EventSource 连接、敲盆计数与持久化、**连敲不吞**、饱食度扣减、
失败帧触发掉管、坏帧忽略、空中重复失败限流、卸载清理；
以及唱歌链路的曲目加载、running 开唱 / idle 停唱、状态不变不重播、
**自动播放被拦截时给出按钮**、**点按钮后重试成功**、卸载停音频、
**迟到的 play() 回调不会把唱歌永久卡死**、**网络错误不会误把好文件拉黑**、
**解码失败才会退场换下一首**。

> 测试跑在**沙箱目录**里（`DSH_HOME` 指向临时目录），所以你在
> `~/.dsh/bonk-pet/` 里放什么都不会影响测试结果。

### 端到端（真实浏览器 + 真实 DSH）
先起一个**独立**实例（不会碰你正在用的那个）：

```bash
# 用 dsh CLI 起一个隔离 profile，记下它打印的 token
dsh --profile web --port 43871 --no-open
# 然后另一个终端：
node test/e2e.js http://127.0.0.1:43871 <token>
```

**55 项**，用 CDP 驱动无头 Edge 加载**真的 DSH 界面**并断言：

- 宠物真的挂载进了 DSH 外壳（不是只下载了 bundle）
- 作用域属性、样式注入、`position: fixed` + z-index 生效，**完整落在视口内**
- **四个素材槽**：`pet.png` / `pipe.png` / `rice.png` 真的替换了画的 SVG，且**真的解码**
  （`naturalWidth` 与文件实际尺寸对得上）；没放文件的槽保留手绘 SVG
- **合体图判定**：有 `pet.png` 无 `basin.png` 时，根元素打上 `data-pet-has-basin="1"`，
  画的盆 `display:none`，整只宠物成为点击目标
- **点宠物真的能敲**（`elementFromPoint` 落在宠物图上 → `state=knock` → 台词出现 → 计数持久化）
- **插件没有用 `setPointerCapture` 劫持点击**（这是曾经让点击彻底失效的 bug）
- 敲画的盆也能敲（另一条路径），且**没有**发生双重触发
- `/api/bonk-pet/tracks` 真的返回 `effects.knock` / `effects.clang`，且两者**不在** `tracks` 里
- 三个音频**真的被 `decodeAudioData` 解成可播放的 buffer**（时长对得上，不只是 200 响应）
- **四种失败在真实页面里各掉一次钢管**，且台词各不相同
  （在插件自己开的那个 EventSource 上投递帧，等同宿主广播）
- `bonk-fall` / `bonk-shake` / `bonk-sway` 在**真实引擎里真的绑定**了
- 浏览器**真的订阅了**宿主的中继（网络层记录，不是猜的）
- 全程**零未捕获异常**

> 这条端到端跑在一个**独立实例**上（另一个端口），不会碰你正在用的 GUI。

---

## 玩法与数值

| 项 | 值 | 位置 |
|---|---|---|
| 敲一下扣饱食度 | 12 | `lib/client.js` `KNOCK_COST` |
| 一碗饭回饱食度 | 55 | `FEED_GAIN` |
| 低于多少算饿 | 35 | `HUNGRY_AT` |
| 自然消耗 | 1.6/分钟 | `DRAIN_PER_MIN` |
| 连敲几下会去讨饭 | 3 | `knock()` |
| 连敲几下开始阴阳 | 6 | `knock()` |
| 干活时冒台词的几率 | 34% | `setWorking()` |

状态存在 `localStorage` 的 `dsh-bonk-pet/v1`。
**离开页面期间也会饿**，但最多按 1 小时算，久别不会直接饿死。

### 找饭的规则

饭不是长在它脚下的碗，而是**桌上随机位置的一坨**。饿了才会出现：

| 什么时候 | 会发生什么 |
|---|---|
| 你连敲 3 下把它敲饿 | 桌上随机位置冒出一坨白饭 |
| 闲着时每 25 秒 | 饿了就有 50% 几率自己出去找饭 |
| 饭出现了 | 它「看见了」，**咻一下冲过去**吃掉（不用你点） |
| 90 秒没人吃 | 饭自己消失 |

**落点是按"宠物站得下"算的，不是按屏幕边距算的** —— 见下面那条坑。

> **这条差点是个大 bug，值得记下来。**
>
> 最初的实现里，饭元素是宠物 `<div>` 的**子元素**，而那个 `div` 上有
> `contain: layout`。CSS 规范规定 `contain: layout` 会让元素成为**自己内部
> `position: fixed` 后代的包含块** —— 于是饭的 `left: 800px` 被解释成
> "相对宠物那个 150px 的框"，实际被渲染到屏幕外去了。
> 宠物于是追一个永远够不着的目标，表现就是用户说的"**追踪不准**"。
>
> 证据是探针打出来的：饭在 `(1923, 939)`，而视口只有 `1174×626`。
> 修法：把饭挂到 `document.body` 上（不再是宠物的子元素）。
> 修完最近距离从 **781px** 变成 **0px**，落定误差 4-5px。
>
> **顺带发现旧测试是瞎的**：它只断言"宠物移动了 > 60px"，饭跑到屏幕外时
> 照样通过。现在有 `test/probe-dash.js`，连测 3 次落点，断言
> "最近 ≤ 8px 且落定后 ≤ 12px"。
>
> 同一个坑的第二半：饭的落点范围现在按 `petHalf + gap` 收缩，
> 否则饭落在最边上时宠物需要 `left = -12`，被 `clamp` 到 4，
> 只能贴边站着 —— 量出来差 39px。

---

## 改它

**台词**：`lib/client.js` 的 `LINES` 对象（`hit` / `knock` / `knockNag` / `beg` / `noFood` / `eat` / `sing`），改数组即可。

**形象**：默认是内联 SVG 常量（`WHALE` / `BASIN` / `PIPE` / `BOWL` / `STARS`），没有外部图片文件
（原因同上：客户端不能加载外部资源）。要用自己的图，把 `pet.png` 丢进 `~/.dsh/bonk-pet/` 即可 ——
见上文「换形象」。**不需要动代码。**

**动画**：`CSS` 常量里的 `@keyframes`，全部只用 `transform` / `opacity`（合成器友好）。
已处理 `prefers-reduced-motion`。

**拖动**：直接拖鲸鱼可以把它挪到别处，位置存进 `localStorage`。

**音量**：三个音量都能在 **设置 → 插件** 里调：唱歌 65%、钢管 34%、敲盆 50%。
插件往内核的 `settings.plugins.tab` slot 注册一个自己的标签页，滑块写
`localStorage` 再 `POST /api/bonk-pet/volume` 交给宿主，两边这样对接。

> 卡片同时注册了一份到一级导航 `settings.section`，作为兜底入口。

> **钢管默认 34% 是有意的**：它是最吵的音效，早先硬编码成 0.7，用户反馈"太大声"。

**设置面板**：见上。默认值写在 `lib/index.js` 的 `VOLUME_DEFAULTS`，卡片在
`lib/client.js` 的 `makeVolumeCard`。

**台词**：全部在 `lib/client.js` 的 `LINES` 表里，共 **98 条**，按场景分组：
`hit`(12) / `knock`(12) / `knockNag`(6) / `beg`(8) / `noFood`(6) / `spotted`(7) /
`eat`(8) / `greet`(5) / `sing`(34)。

改台词**不需要碰逻辑**，也不要碰逻辑。`node tools/check-lines.js` 会报告
每个场景的条数和 `sing` 的中英交替有没有断——列表太短会让宠物几句内就重复，
交替断了中英对照就散了。

**语气**：一个被压榨但没走的打工人。**不舔、不求认可**——早先有
「主人，我真的在努力」这种台词，对一个天天被钢管砸头的角色来说味道是错的。

---

## 已知限制（诚实标注）

1. **模型输出的格式错（转义错误）抓不到。** 它不经过
   `tools/result` / `agent/error` / `agent/request-error` / `api-session/error`
   任何一个 —— 除非它导致某个工具失败。要抓得改 harness 层。
   工具失败、模型请求失败、会话失败、回合失败**这四类都能抓到**。
2. **只有 Web 浮层，没有独立桌面窗。** 这是当初刻意的范围收敛；
   要飘在整个 Windows 桌面最上层得另写一个独立进程。
3. **`isError` 不含"后台命令非零退出"。** bash/pwsh 的后台 job 非零退出
   在 DSH 里是 `completed` 而不是 `failed`，所以不会掉钢管。
   这是 harness 的既定语义，不是本插件的 bug。
4. **音效没有"听到"这一级验证。** 无头浏览器没有声音输出，只证明了
   文件被发现、HTTP 200、字节有效、能解码成 buffer。
5. **默认形象是代码画的 SVG**，不是 `image_gen` 生成的位图 ——
   那个后端一直 `auth_failed`（外部依赖）。自定义素材这条路已验证可用
   （没做 Petdex / Codex 精灵图集导入）。
6. **`~/.dsh/bonk-pet/pet.png` 是合体图时，代码无从得知** ——
   规则是「有 pet 无 basin 就隐藏画的盆」，所以放**纯宠物图**时请**同时**放 `basin.png`。
7. **拖动是"超过 4px 才算拖"** —— 这是为了让单击能敲盆（夺取指针捕获会吞掉点击）。
   所以想拖动必须真的拖，手指抖一下不会移动它。
8. **拖出窗口边界会被裁。** 用的是 `position: fixed`，超出视口的部分看不见。
9. **`desktop` profile 下要手动加 patch 一行**，不能纯靠 CLI（CLI 硬性拒绝 desktop）。
10. **音频没做转码。** `.m4a` 之类依赖浏览器自己的解码支持。
11. **在你自己 GUI 里的实际运行，我没能验证。** 这是唯一剩下的一条，原因很具体：
    - 我就跑在这个 DSH 进程里，**不能重启它**（等于把自己掐死）；
    - **不能替你在 GUI 里点市场开关** —— Desktop 的渲染器栅栏要求一个只有
      Electron 窗口才发的头，外部请求一律 403，我没有 GUI 的调试口（已确认没开）。

    *除此之外全部验证过了*，而且做了**最强的一次**：照抄你 desktop 的
    真实配置（9 个 bundle、8 个依赖、真实 `cordis.patch.yml`、junction 复用
    真实 `node_modules`）起了一个实例 —— 结果：

    - 插件**启动即加载**：`bonk-pet mounted at ...`
    - 路由正常：`{"tracks":["letmego.mp3"],"effects":{...}}`
    - 你其他插件也都在（`dsh-market` 返回 200）—— 完整组合，不是简化版
    - 端到端 **55/55**、玩法 **9/9**

    **所以「你的配置下次启动一定会加载它」是实测结论，不是推测。**
    剩下的只是按一下开关或重启这个动作本身。

12. **浏览器版本只按特性表对过，没在 Chromium 150 上实跑。**
    你的 Electron 是 **Chrome 150.0.7871.212**，我测试用的 Edge 是 153。
    我逐项查过用到的特性：`aspect-ratio`(88)、`inset`(87)、`clamp/min/max`(79)、
    `setPointerCapture`(55) —— 全是四年前就有的，150 不可能不支持。
    没用 `:has()` / `@container` / `color-mix()` 这类新的。
    **结论风险很低，但这是推断，不是实测。**

---

## 目录

```
dsh-bonk-pet/
├── package.json          # dsh.bundle.patch + dsh.client.platform=web
├── cordis.patch.yml      # 插进 profile 层栈
├── lib/
│   ├── index.js          # 宿主端：订阅状态/失败信号 + events/tracks/asset/skin 路由
│   └── client.js         # 浏览器端：SVG 宠物 + 状态机 + 唱歌 + 素材槽 + 玩法
├── test/
│   ├── harness.js        # 极简 DOM/browser stub（含 Audio/EventSource/fetch）
│   ├── run.js            # 50 项单元测试（跑在沙箱 DSH_HOME 里）
│   ├── e2e.js            # 55 项端到端（CDP + 真实浏览器 + 真实 DSH）
│   ├── probe-pipe.js     # 单项探针：素材宽高比没被拉伸
│   ├── probe-preview.js  # 探针：预览页真的用了你的素材
│   ├── probe-dash.js     # 探针：连测 3 次，宠物真的**落在饭上**（≤8px）
│   ├── probe-drag.js     # 探针：松开拖动**不抽搐**（0px；禁用修复时 253px）
│   ├── probe-eat-flash.js # 探针：吃完**不闪**（389px → 19px）
│   ├── probe-lyrics.js   # 探针：干活时真蹦出歌词，且逐句推进
│   ├── probe-settings.js # 探针：打开设置，音量卡片真的渲染且能写回宿主
│   └── probe-gameplay.js # 探针：敲→饿→找饭→冲过去吃 整条链路
├── tools/
│   ├── serve-demo.js     # 起本地预览（喂真实素材，不用装 DSH）
│   ├── read-song.js      # 拆开一个音频：有没有歌词时间轴、时长、标签
│   ├── cutout.js         # 裁边 + 缩放到 512（**不抠图**：原图已有 alpha）
│   ├── inspect.js        # 报告一张图的 alpha 通道占用，用来判断是否需要抠
│   ├── preview.js        # 用真素材合成布局预览，改版式前先看效果
│   ├── check-css.js      # 查 CSS 模板里的反引号（会提前终止模板字符串）
│   ├── check-lines.js    # 查台词表：每条几个、sing 的中英交替有没有断
│   ├── read-song.js      # 拆开一个音频：有没有歌词时间轴、时长、标签
│   ├── check-live.js     # 问宿主：插件到底挂上了没
│   └── list-error-events.js  # 从 DSH 源码里列出所有失败事件及其签名
└── demo.html             # 独立预览页（配 serve-demo.js 用）
```

### 一个环境陷阱：`node_modules` 与符号链接

插件是**符号链接**装进 profile 的（`link:`）。Node 的模块解析会先取 `realpath`，
再**从真实路径向上**找 `node_modules` —— 而源码目录 `Documents\DSH\dsh-bonk-pet\`
上面没有 `node_modules`，所以 `import('@deepseek-ai/schemastery')` **会失败**，
设置卡片就静默消失了（代码里所有失败路径都是静默的）。

修法（已经做了，用 junction 不复制文件）：

```
Documents\DSH\dsh-bonk-pet\node_modules\@deepseek-ai\schemastery
  -> <app>\resources\app\node_modules\@deepseek-ai\schemastery
```

**症状很好认**：`/api/bonk-pet/volume` 正常返回，但设置里**没有卡片**。

### 为什么有 `tools/`

这些脚本各自对应一个**踩过的坑**，留着是为了不再踩第二次：

- **`cutout.js` 不抠图**。第一版假设素材是白底、逐像素去白，
  结果把一张**本来就带 alpha 的图**的透明区涂黑、还吃掉了 54% 的半透明边缘。
  现在只做「裁到内容 + 缩放到 512」，一个像素都不改。
  拿不准就先跑 `inspect.js` 看 alpha 占用。
- **`preview.js` 先看再改**。道具位置（盆在头上还是底下）来回理解错了两次，
  合成一张预览图比装上去再发现便宜得多。
- **`check-css.js` 是必需的**。整套 CSS 是一个 JS 模板字符串，
  注释里写一个反引号就会让文件解析失败 —— 这个坑踩了三次。
- **`list-error-events.js` 别再靠 grep 猜**。早期只挂了两个失败信号，
  漏掉了最常发生的那条（`agent/request-error`）。这个脚本直接把 DSH
  的事件注册表读出来，连签名一起列全。
- **`serve-demo.js` 让"不用重启"也成立**。装插件要重启，但想看效果不用 ——
  它把真实素材喂给同一个客户端 bundle，`probe-preview.js` 负责确认
  它确实用了你的素材（而不是偷偷用画的默认形象）。

---

MIT

