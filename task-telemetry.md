# task-telemetry.md

Sub-agent context telemetry for the llm-interview repo, recorded per wave per the small-model-orchestration skill. Purpose: calibrate task granularity and model choice against observed context ceilings.

## 2026-08-21 Wave 1 — Dashboard refactor frontier #32 ∥ #33（llm-interview / main）

| task | 模型 | 任务范围 | 结果 | 失败模式 | context 峰值 | compaction | 耗时 |
|---|---|---|---|---|---|---|---|
| ShadcnSetup | opencode-go/deepseek-v4-flash | #32 shadcn init + registries + theme | **中断废弃** | 基础设施：429 周配额耗尽 | 29,941 | 0 | ~30s |
| PortDataLayer | opencode-go/deepseek-v4-flash | #33 数据层移植 + 33 单测 | **中断废弃** | 基础设施：429 周配额耗尽 | 0（首发即拒） | 0 | ~2s |
| ShadcnSetup-2 | ai-02/qwen3.8-27b | 同上 | **中断废弃** | 基础设施：后端持续 500 ×6 | 0（口径异常） | 0 | ~25min |
| PortDataLayer-2 | ai-02/qwen3.8-27b | 同上 | **中断废弃** | 基础设施：后端持续 500 ×6 | 0（口径异常） | 0 | ~25min |

### 备注
- 两次失败均为 provider 侧基础设施问题（配额 / 后端 500），与任务粒度、prompt 质量无关；无任何文件写入，工作区保持干净。
- ai-02 的 usage 记录为 0，属于该 provider 口径问题（跨 provider 比较前先确认口径）。

## 2026-08-21 Wave 2 — 同两票重发（task agent = deepseek/deepseek-v4-flash）

| task | 模型 | 任务范围 | 结果 | 失败模式 | context 峰值 | compaction | 耗时 |
|---|---|---|---|---|---|---|---|
| ShadcnSetup-3 | deepseek/deepseek-v4-flash | #32 shadcn init + registries + theme，~10 文件可写 | 成功（4/4） | — | 30,392 | 0 | 13m44s |
| PortDataLayer-3 | deepseek/deepseek-v4-flash | #33 数据层移植，6 文件可写 | 成功（33/33 测试） | — | 21,393 | 0 | 1m4s |

### 备注
- 两票均一次通过，编排者门禁（lint + tsc -b + vite build + 33 vitest + 浏览器冒烟）全绿，diff 对照无越界、无残留。
- ShadcnSetup-3 自主解决两个环境坑并如实上报：① shadcn CLI 的 Node fetch 过不了本地 socks5 代理，unset 代理变量后成功；② CLI 的 tsconfig-paths 解析不认根 solution-style tsconfig，曾把生成文件写进字面 `@/` 目录，agent 自行迁移清理。
- 消息数差异（288 vs 43）主要来自 CLI 交互与文档抓取；context 峰值均远低于退化区。

## 2026-08-22 Wave 3 — #34 App shell + Home view（task agent = deepseek-v4-flash，思考模式开启）

| task | 模型 | 任务范围 | 结果 | 失败模式 | context 峰值 | compaction | 耗时 |
|---|---|---|---|---|---|---|---|
| AppShellHome-2 | deepseek/deepseek-v4-flash (thinking) | #34 一整票：shell+路由+header+hero+统计+过滤+索引，参考材料含 400 行 shader 源码 | **退化废弃**（96 次工具调用，write/edit = **0**） | M1 变体：**compaction 诱导的探索失忆循环** | 58,328 | **3** | ~55min（人工取消） |

### 备注
- 失败机制：input 爬至 ~58k → compaction → 探索结论（读过什么、决定怎么做）被压缩丢失 → 重读同一批文件（blinking-squares ×8、issue ×7、use-theme ×4）→ 再 compaction。三次循环，从未进入写作阶段。
- 教训：58k 未达 qwen 的 77k 生成退化点，但**探索阶段跨多次 compaction 即致命**——结论必须在 compaction 前固化为文件。
- 校准结论：对 deepseek-v4-flash(thinking)：单票参考材料要裁剪（不喂 400 行源码）、目标单一化、峰值压在 <40k（不触发 compaction）；prompt 加硬约束「文件只读一次、不重查已给信息」；编排者每 ~5 分钟监控 write 计数，10 分钟无写入即介入。
- 处置：#34 拆为 #34a（shell+路由+SiteHeader）与 #34b（Home view）两票顺序执行。

## 2026-08-22 Wave 4 — #34 拆分重发（task agent = qwen-27b-latest @ ai-02，thinking 开启）

| task | 模型 | 任务范围 | 结果 | 失败模式 | context 峰值 | compaction | 耗时 |
|---|---|---|---|---|---|---|---|
| AppShell（误派发） | new-api-think/qwen-27b-latest | 编排者参数错误（task 字段占位符） | **取消重发** | 编排失误，非模型问题 | 0 | 0 | <1min |
| AppShell-2 | new-api-think/qwen-27b-latest | #34a：shell+路由+SiteHeader，5 文件可写，参考材料内联 | 成功（4/4） | — | 28,798 | 0 | 2m11s |
| HomeView | new-api-think/qwen-27b-latest | #34b：hero+统计+过滤+索引，4 文件组 | 成功（5/5 + 1 轮修复） | — | 48,477 | 0 | 12m35s + ~8min 修复 |

### 备注
- 拆分 + 「文件只读一次 + 5 次调用内开写 + 参考材料内联」三管齐下：#34a 从 55min 零产出 → 2m11s 一次通过。同一模型的成败完全由任务塑形决定。
- HomeView 初版浏览器冒烟发现 2 个真 bug（oklch 读回不归一化导致 hexToRgb 回退黑色；R3F Canvas in-flow 定位把 overlay 挤下屏）——hub 消息断点续修一轮通过。**冒烟门禁再次证明价值：agent 自验全绿 ≠ 视觉正确**。
- 教训订正：编排者给的「canvas fillStyle 归一化」hint 在当前 Chromium 不成立（原样返回 oklch 字符串）——agent 自行加了 `#rrggbb` 校验 + 每主题兜底 hex。写进 prompt 的"捷径"也要被 agent 防御性验证。
- 中途事故：用户重置模型配置杀掉首跑 AppShellHome（51,826 峰值，尚未写文件，无残留）。

## 2026-08-22 Wave 5 — #35 Question grid（task agent = qwen-27b-latest thinking）

| task | 模型 | 任务范围 | 结果 | 失败模式 | context 峰值 | compaction | 耗时 |
|---|---|---|---|---|---|---|---|
| QuestionGrid | new-api-think/qwen-27b-latest | #35：timeline+card+grid，3 文件 + 1 项 React Bits 选型 | 成功（3/3，Change 4 按编排者指令放弃） | 前轮中 **探索失控前兆**：112k 峰值、36 调用 0 写入 | 115,478 | 0 | 12m55s |

### 备注
- 失控点不是读代码而是**逛 React Bits 文档站 + 反复重试 registry add**（animated-list 400 / depth-card 404）——外部文档页单页 40KB+，是最贵的探索材料。5 分钟监控在 36 调用 0 写入时介入 steering，agent 立即回归写作并 13 分钟内完成。
- 校准新增：① 派发时若要用 registry 组件，**编排者预验证组件名可用性**并把确切 item 名写进 prompt（如 `@reactbits-starter/blinking-squares-tw`），禁止 agent 自行浏览选型；② 监控规则「10 分钟无写入即介入」有效。
- Registry 事实：`@reactbits-pro` 命名空间服务 blocks/templates（pricing-1 等），单组件多在 `@reactbits-starter` 且带 `-tw`/`-css` 后缀；pro 站的组件目录 ≠ starter registry 内容。
