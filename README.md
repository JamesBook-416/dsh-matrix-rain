# matrix-rain · 矩阵雨动态皮肤

DeepSeek Harness Web GUI 的「黑客帝国字符雨」动态皮肤插件。由 Win32 GDI 屏保
`matrixrain.c v8`(JamesBook-416 的大学期末作业)忠实移植为 JavaScript:
常量、40ms 固定步进节拍、冲击波物理全部保留。

**独立运行,不依赖任何皮肤/第三方**——可与任意皮肤叠加共存,与官方默认界面也能直接搭。

## 效果演示

**冲击波三连击** —— 经典绿 · 波速 15 · 字符被波前推飞后阻尼回弹

![冲击波三连击](docs/demo-rain-glm.gif)

**任务运行时自动下雨** —— 仅任务模式 · TPS 自适应(144 tok/s 高速雨)

![任务运行时下雨](docs/demo-rain-deepseek.gif)

**设置页全览** —— 色轮 / 滑杆 / 即时预览,全部实时生效

![设置页全览](docs/demo-settings.gif)

## 特性

- **全屏程序化数字雨**:白头渐变尾、随机 glitch、火花,零静态素材,零依赖
- **左键冲击波**:正弦涟漪提亮 + 波前物理推力把字符推飞、阻尼回弹;波速可调且与雨速完全解耦(任意雨速/刷新率下,波速、涟漪寿命、回弹节奏恒定)
- **鼠标光晕**:划过点亮附近字符
- **设置侧边栏专属页(设置 → 矩阵雨皮肤)**,全部实时生效:
  - 速度模式:手动倍率(50%~400%)或 **TPS 跟随**(解析宿主 `xx tok/s` 用量,3200/(tps+40) ms 自适应,等效 >250 tok/s 触发随机高亮);两者互斥,跟随开启时倍率让位
  - 冲击波时速:5~120 px/帧,独立滑杆
  - 色板 9 种:经典绿 / 赛博青 / 紫雨 / 灰阶 / 琥珀 / 血红 / 墨绿 / 墨灰 / **彩虹**(逐格流转动态光谱);或用 **HSL 色轮**(角度=色相 半径=饱和度+亮度滑杆+RGB/色值输入+常用色板)自定义字符色
  - 背景衬色层:雨幕区域内铺底色增强对比(默认关,只铺雨幕区域不罩全窗)
  - 界面染色:`color-mix` 调和宿主主题色变量,整台客户端染上你选的色调
  - 何时下落:随时 / **仅任务执行时**(本工作区任意会话在跑即下,含后台会话;跨工作区不误触发)
  - 雨幕区域:全窗口 / 仅对话区
- **断雨迟滞**:任务回合分段间隙不闪断;**陈旧标记免疫**:被中断会话的历史 running 状态不会误触发
- 荧幕(screen)/ 压印(multiply)双叠加,按宿主亮度自动切换;`prefers-reduced-motion` 降级静态一帧;页面隐藏暂停;卸载完全复原

## 安装

前提:DeepSeek Harness 桌面端(已实测 0.2.0-rc.2)。

```powershell
# 方式一:官方 CLI 装本地目录(路径保持纯 ASCII;<DSH> 即你的 DSH 安装目录)
<DSH>\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add <本仓库本地路径>

# 装完在 设置 → 插件 里确认 dsh-matrix-rain 已启用,刷新页面即见雨落。
```

启停:设置 → 插件 页开关本插件;与皮肤管理器(第三方)互不干扰——本插件不注册为皮肤,
皮肤管理器列表里看不到它,也因此**切换任何皮肤都不会动它**。

## 设置页一览

动态导览见上方「效果演示」第三支;色轮 / RGB 精确输入 / 常用色板 / 各滑杆的静态细节见
`docs/settings-1.png` ~ `docs/settings-3.png`:

## 与其它皮肤的关系

| 场景 | 行为 |
|---|---|
| 官方默认界面 | 直接叠加,开箱即用 |
| 任意第三方皮肤 | 叠加共存,互不影响(本插件不含 skin.json,不参与皮肤互斥) |
| 皮肤管理器 | 互不感知;它管它的皮肤切换,雨只听插件页开关 |

## 回滚

1. **一键级**:若宿主弹「unavailable」框 → 点「Disable third-party plugins…」(安全禁用,非卸载)。
2. **插件级**:设置 → 插件 → 禁用本插件,界面立即复原。
3. **文件级**:删 profile `node_modules\dsh-matrix-rain` 并从 cordis.patch.yml 移除对应行。

诊断:`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log`(首行含出错包名)。

## 已知上游问题(非本插件缺陷)

**web boot 启动审计竞态(DSH 0.2.0-rc.2)**:页面重载中若插件 combo 脚本仍在传输,
宿主启动审计可能在「导入仍在途」时误报 `import failed` 并弹致命框。导入实际随后正常完成——
**重启即好,配置零损伤**。根因:审计先于插件脚本执行,无法在插件侧防御;修复属 DSH 官方
(审计应等待在途导入,而非将"在途"判为"失败")。

## 开发

```powershell
node scripts/build-client.mjs   # src/engine.js 内联进 lib/client.js
node scripts/validate.mjs       # 五关装前校验,必须 ALL GATES GREEN
node scripts/serve.mjs          # 本地静态服务(端口 8123)
# 浏览器打开:
#   test/harness.html?demo=1&selftest=1    引擎量化自检
#   test/client-harness.html               产物全链路断言(31 项,零回归门槛)
```

修改引擎后必须 build + 两个 harness 全过 + validate 全绿再装。
`scripts/` 还包含本机诊断探针(plugin_manager / CDP 取证 / 桌面端 localStorage 的
SSTable+Snappy 解码器 read-localstorage.mjs 等),路径为写死的本机绝对路径,按需改造。

## 客户端插件的两条防炸机要点(实踩过)

1. 声明 `dsh.client` 就**必须有** `exports["./client"]`,否则宿主启动组装直接拒启(2026-10-12 事故)。
   validate.mjs 逐字复刻了宿主 `clientExportOf` 校验语义做双重验证。
2. manifest 层 `dsh.client.inject` 是"向目标 UI 插件注入代码"的另一套语义——常驻名册类插件
   保持 `"inject": []`;声明了宿主不认识的注入目标会被**静默丢弃整个条目**(2026-10-14 实踩)。

## 安全设计

- 纯展示层:不注入服务、不发事件、不触达模型请求
- 所有 DOM/CSS/监听器写入登记回收,`apply()` 永不抛异常,失败只降级不影响宿主
- 31 项全链路断言(门控/预览/迁移/染色/任务检测/工作区检测/裁剪/清理)作为改动门槛

## 来源与许可

MIT(见 LICENSE)。引擎为 matrixrain.c v8 的移植,视觉效果全部程序化生成,无第三方美术素材。
感谢 [orca-link](https://github.com/) 等社区皮肤提供的宿主 DOM 配方参考。
