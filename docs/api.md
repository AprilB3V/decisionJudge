# DecisionJudge 应用契约

## 0.3 问答助手契约（2026-09-24）

- `chatEndpoint(baseUrl): string` 接受 HTTPS 基础地址或完整 `/chat/completions` 地址；本机回环可使用 HTTP。拒绝 URL 内嵌凭据、查询参数和片段。
- `requestAssistant(settings, apiKey, decision, messages, signal?)` 发出非流式 `POST`，请求 `{model,messages,stream:false}`。密钥仅在 Authorization header；不带 cookie、不跟随重定向，60 秒超时，可取消。HTTP 错误只显示状态与通用恢复建议，不回显响应体。
- `assistantContext(decision)` 仅投影当前问题、日期、方案、维度及其备注/权重、底线；排除 ID、评分证据、执行历史、预测、复盘和快照。
- `parseAssistantReply(content)` 接受 `{message,proposal:null|DesignProposal}` 或纯文本提问；结构化草稿用 Zod 检查规模、名称唯一性、有限非负权重与完整性，未知字段不写入决策。分数不在助手 DTO 中。
- `proposalChange(proposal)` 重建 ID、归一化权重、创建空评分及未知约束。UI 需先展示预览、确认替换，并验证比较内容指纹未改变，然后调用 session 更新。
- `loadAssistantSettings/saveAssistantSettings` 只持久化地址、模型、预设 ID 和系统提示词；密钥由内存单独持有。对话离开编辑器后清除，不在备份中。

普通/专业模式复用 `advancedUiExpanded`；新备份 `appVersion=0.3.0`，格式和 schema 仍为 1。完整响应 DTO 见 [设计文档](./assistant-design.md)。真实供应商连通需要用户自行配置可用地址、模型及密钥。

> 当前实现：0.2 工作区版本，2026-09-22。以下“0.2 实际契约”描述已实现代码；后面的 0.1 内容保留为历史目标设计，不能据此调用尚未存在的接口。

## 0.2 实际契约

### 包内服务与状态

应用没有 HTTP API。当前边界是 TypeScript 函数与 `DecisionSession`，以 [decisionService.ts](../src/application/decisionService.ts)、[decisionSession.ts](../src/application/decisionSession.ts)、[workflow.ts](../src/domain/workflow.ts) 为准。同步函数返回实体或抛出 `Error`；异步存储返回 Promise，失败时 reject。历史设计中的 `Result<T>`、统一 `AppErrorCode`、`updateDecision(command)` 和可选择旧引擎的调用格式尚未实现。

| 实际入口 | 返回与行为 |
| --- | --- |
| `createDecision(templateId)` | 新建 `Decision`，`revision=1`、`schemaVersion=1`，不写数据库；内置五个模板包含空白模板 |
| `createDecisionFromPreset(preset)` | 复制方案、维度、锚点和权重，重建内部 ID 与空评分，不复制工作流记录 |
| `createPreset(decision, name, description?)` | 生成可复用结构；不带评分、证据、工作流或快照 |
| `applyDecisionChange(decision, change)` | 同步验证工作流交互、清理失效的任务绑定并更新 `updatedAt`；比较内容变化使状态回到 `draft`，旧选择仍保留在快照 |
| `evaluate(decision)` / `evaluateDecision(decision)` | 返回 `EvaluationResult`；缺少评分、权重不合法等情况以 `ready=false` 与 `errors` 表示 |
| `updateRevision(decision)` | 生成 `revision+1`、当前计算版本及更新时间，不单独写库 |
| `createSnapshot(decision, chosenOptionId)` | 生成已验证的快照候选及 `decided` 决策副本；选择必须在当前排名中且所有硬约束均核实可行；持久化由 `saveSnapshot` 完成 |

`DecisionSession` 是编辑器保存协调器。`update(change): boolean` 立即更新有效内存草稿，失败返回 `false` 并保留原输入；`flush(): Promise<void>` 串行排空待保存修改；`confirm(optionId)` 先 flush，再原子保存快照。`getState()` / `subscribe()` 提供 `draft/dirty/saving/confirming/error`。编辑器在 450 ms 空闲后发起 flush，写入期间的新输入保留自己的内容和更新时间；确认期间禁止新修改。保存冲突保留草稿，用户可重试或导出当前草稿。

### 当前数据与工作流

实际 `Decision` 采用平铺 `templateId/templateName`、`advanced` 和 `workflow?`，完整定义见 [types.ts](../src/domain/types.ts)。不是历史 DTO 中的 `template/advancedSettings/draft` 嵌套结构。

```ts
type DecisionWorkflow = {
  verificationTasks: VerificationTask[];
  investments: InvestmentRecord[];
  investmentBoundary?: { amount: number | null; hours: number | null };
  actionPlan?: ActionPlan;
  predictions: Prediction[];
  reviews: DecisionReview[];
  reviewDraft?: DecisionReview;
};
```

`Decision.workflow` 缺失时界面按空工作流使用；创建新决策会初始化四个空数组。`reviewDraft` 是可编辑、可自动保存及备份的复盘草稿；追加成功后清空草稿，并在实际点击追加时生成 `createdAt`。记录不是独立 object store。

| 工作流入口 | 当前约束 |
| --- | --- |
| `validateWorkflow(workflow, asOf?)` | 形状由导入 Zod schema 先验证；此函数检查金额、单位、累计可回收额、真实日期、预测时序与复盘内容，返回 `{ valid, errors }` |
| `validateWorkflowTransition(previous, next, asOf?)` | UI / 应用交互使用；已封存原始预测字段不可修改或删除，已结算结果不可改写，已追加复盘只能保留原顺序并追加；预测先封存再记录结果 |
| `sealPrediction(prediction, at?)` | 陈述、概率和事前依据完整，截止日期严格晚于封存的本地日期，且尚无结果；返回新封存对象 |
| `settlePrediction(prediction, outcome, outcomeEvidence, asOf?)` | 预测已封存，截止的整个本地日已经结束，结果证据非空；结果与依据分开保存，结算后锁定 |
| `appendReview(workflow, review, at?)` | 返回追加记录后的工作流；复盘至少有一项内容，时间戳取实际追加时刻，不复用草稿起草时间 |
| `investmentTotals` / `boundaryExceeded` | 人民币与小时各自合计；非负有限数值，累计回收金额不大于实际金额，时间不能回收；达到边界即复评，零边界有效 |
| `brierScore(predictions, asOf?)` | 仅对合法、已封存且已结算的预测计算平均平方误差；没有有效样本返回 `undefined`，不是总体决策质量分 |

`asOf/at` 默认当前 ISO 时间，可显式传入以测试或读取历史。截止日期为 `YYYY-MM-DD`，判断按本地日；封存和结算存储带时区的时间戳。持久化重放与 UI 的严格逐步交互分开：存储允许保存经过验证的最终聚合，即使失败重试跨日或多个合法交互尚未逐个落盘；已持久化的封存字段、结算结果和复盘历史仍受不可变保护。

### 仓储、版本和快照

实际入口见 [localRepository.ts](../src/infrastructure/localRepository.ts)。

| 入口 | 实际签名与一致性 |
| --- | --- |
| 查询 | `listDecisions()`、`getDecision(id)`、`listSnapshots(decisionId?)`、`listPresets()`；无分页或筛选 query DTO |
| 决策写入 | `saveDecision(decision, expectedRevision?)`；无 expectedRevision 只可新增。更新要求数据库版本等于 expectedRevision，传入新版本等于 expectedRevision+1，在一个读写事务内检查并写入，否则抛出 `revision-conflict` |
| 快照写入 | `saveSnapshot(snapshot, expectedRevision)`；同一事务更新 Decision 并 `add` Snapshot，ID 冲突或任一步失败全部回滚，历史快照不会被 `put` 覆盖 |
| 删除 | `deleteDecision(id, deleteSnapshots)`；按参数决定是否删除相关快照，跨 store 原子执行。当前首页删除同时删除快照 |
| 预设 | `savePreset(preset)` / `deletePreset(id)`；预设独立存储 |
| 导入写入 | `replaceAll(decisions, snapshots, presets=[])` 名称沿用早期代码，实际是跨三个 store 的 `bulkAdd` 追加事务；不清空或覆盖现有记录 |

新创建快照的 `sourceRevision === decision.revision === result.evaluatedRevision`，三个计算版本字段相互对应。快照创建先在内存中生成新版本及结果，再由仓储原子提交。导入历史快照保留原结果和原计算版本，包括旧版本留下的 revision 差异；不为满足新约束重算历史。

### 导入导出文件

`exportPayload(decisions, snapshots, presets=[])` 返回 JSON 字符串，根对象包含 `format="decisionjudge-export"`、`formatVersion=1`、`exportedAt`、`appVersion="0.2.0"`、`schemaVersion=1` 以及三个数组。`decisions[]` 是实际完整 `Decision`，没有额外的 `draft` 包装。`workflow`、`reviewDraft`、评分证据和快照输入随聚合完整导出。

解析与导入准备由 [backup.ts](../src/application/backup.ts) 实现：

1. `parseBackup(text)` 检查格式、支持的 schema（1 或 2）、形状、ID、引用与工作流语义；缺失 `presets` 按空数组处理，`workflow` 可缺失。历史工作流按记录的 `updatedAt` 检验，未知可选扩展字段保留。JSON/schema/引用错误在写库前拒绝。
2. `prepareBackupImport(payload, existing)` 返回深拷贝的追加数据。ID 与本地决策、快照、预设或孤立快照来源冲突时生成新 ID，并同步改写 `snapshot.decisionId` 和内嵌 `snapshot.decision.id`；不改变内部评分 ID、封存结果或原记录。
3. UI 对文件限制 10 MiB，解析和准备后调用 `replaceAll` 原子追加。当前没有 `previewToken`、独立提交令牌或版本迁移注册器。

### 计算边界

当前引擎版本为 `weighted-utility-v2`：1–10 锚点评分乘以非负权重，正权重合计为 1；权重为零的维度不要求评分。结果使用 `rows`、`ready/errors`、相对贡献差、并列首位集合和未知约束提示。不可行方案排除，未知约束方案可暂列比较但不能确认。敏感性分析在合法权重范围内做单维度 ±0.05 扰动并按比例调整其他权重。

因素、自动值换算、情景概率、风险调整、折现和边际分析均尚未参与计算；旧开关只作为兼容字段保留，`activeAdvancedModules` 为空。信息价值提示、投入记录、行动和复盘也不会自动改变比较分。

## 历史目标设计：0.1（保留备查，未全部实现）

以下为 2026-08-23 的目标接口草案。与上面的 0.2 实际契约不一致时，以当前代码和 0.2 说明为准；尤其下文 DTO、类型化错误、token 导入和高级计算公式不代表已交付功能。

> 状态：已实现基线，持续演进
> 版本：0.2
> 日期：2026-08-23

## 1. 契约边界

MVP 不包含后端或 HTTP API。本文定义 UI 可调用的应用服务契约、仓储端口和导入导出文件契约。这些 DTO 与 IndexedDB 实体分离，未来可为云端服务或微信小程序适配。

所有操作为本地调用，不需要认证、授权、HTTP 头、速率限制或网络幂等键。写操作通过 `expectedRevision` 提供本地乐观并发控制。

## 2. 通用类型

```ts
type UUID = string;
type ISODate = string;      // YYYY-MM-DD
type ISODateTime = string;  // RFC 3339 UTC timestamp

type AppErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_QUOTA_EXCEEDED"
  | "IMPORT_FORMAT_INVALID"
  | "IMPORT_VERSION_UNSUPPORTED"
  | "CALCULATION_VERSION_UNSUPPORTED"
  | "SNAPSHOT_IMMUTABLE"
  | "UNEXPECTED";

type AppError = {
  code: AppErrorCode;
  messageKey: string;
  fieldErrors?: Array<{ path: string; messageKey: string }>;
  safeDetails?: Record<string, string | number | boolean>;
};

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };
```

`messageKey` 是集中文案 key，不将持久化或库异常文本直接暴露给 UI。

## 3. 核心 DTO

```ts
type DecisionStatus = "draft" | "decided";
type Feasibility = "feasible" | "infeasible" | "unknown";

type DecisionSummary = {
  id: UUID;
  title: string;
  templateId: string;
  status: DecisionStatus;
  optionCount: number;
  updatedAt: ISODateTime;
  revision: number;
};

type AdvancedModuleState = {
  factors: { enabled: boolean };
  valueMapping: { enabled: boolean };
  scenarios: { enabled: boolean };
  risk: { enabled: boolean };
  discounting: { enabled: boolean };
  marginalAnalysis: { enabled: boolean };
};

type OptionDto = {
  id: UUID;
  name: string;
  description?: string;
  isStatusQuo: boolean;
};

type ConstraintDto = {
  id: UUID;
  label: string;
  description?: string;
  evaluations: Array<{
    optionId: UUID;
    status: Feasibility;
    reason?: string;
  }>;
};

type ValueMappingDto = {
  enabled: boolean;
  direction: "higher_is_better" | "lower_is_better";
  floorValue: number;  // 换算为 1 分
  targetValue: number; // 换算为 10 分
  unit: string;
  clamp: true;
};

type FactorDto = {
  id: UUID;
  name: string;
  description?: string;
  enabled: boolean;
  localWeight: number; // 0..1
  valueMapping?: ValueMappingDto;
};

type CriterionDto = {
  id: UUID;
  name: string;
  description?: string;
  enabled: boolean;
  weight: number; // 0..1
  scoringAnchorLow: string;
  scoringAnchorHigh: string;
  factorModeEnabled: boolean;
  valueMapping?: ValueMappingDto;
  factors: FactorDto[];
};

type ScoreDto = {
  id: UUID;
  optionId: UUID;
  criterionId: UUID;
  factorId?: UUID;
  scenarioId?: UUID;
  value?: number; // 1..10；自动换算时由引擎派生
  rawValue?: number;
  rawUnit?: string;
  evidence?: string;
  source?: string;
};

type SunkCostDto = {
  id: UUID;
  label: string;
  category: "money" | "time" | "energy" | "other";
  amount?: number;
  unit?: string;
  incurredAt?: ISODate;
  recoverable: boolean;
  note?: string;
};

type ScenarioDto = {
  id: UUID;
  optionId: UUID;
  kind: "optimistic" | "baseline" | "pessimistic";
  probability: number; // 0..1
  scoreOverrides: ScoreDto[];
};

type CashFlowStreamDto = {
  id: UUID;
  optionId: UUID;
  criterionId: UUID;
  scenarioId?: UUID;
  currency: string;
  entries: Array<{ date: ISODate; amount: number }>;
};

type AdvancedSettingsDto = {
  scenarios: {
    enabled: boolean;
    items: ScenarioDto[];
  };
  risk: {
    enabled: boolean;
    aversion: number; // 0..1
    method: "downside_deviation";
  };
  discounting: {
    enabled: boolean;
    annualRate: number; // 0..1
    baseDate: ISODate;
    streams: CashFlowStreamDto[];
  };
  marginalAnalysis: {
    enabled: boolean;
    statusQuoOptionId: UUID;
  };
  sensitivity: {
    enabled: boolean;
    weightDelta: number; // 0..0.5
  };
};

type DecisionView = {
  id: UUID;
  revision: number;
  schemaVersion: number;
  calculationVersion: string;
  template: { id: string; version: number; name: string };
  title: string;
  objective?: string;
  decisionDate?: ISODate;
  status: DecisionStatus;
  chosenOptionId?: UUID;
  advancedUiExpanded: boolean;
  advancedModules: AdvancedModuleState;
  options: OptionDto[];
  constraints: ConstraintDto[];
  criteria: CriterionDto[];
  scores: ScoreDto[];
  sunkCosts: SunkCostDto[];
  advancedSettings: AdvancedSettingsDto;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

type DecisionDraftDto = {
  template: { id: string; version: number; name: string };
  title: string;
  objective?: string;
  decisionDate?: ISODate;
  advancedUiExpanded: boolean;
  options: OptionDto[];
  constraints: ConstraintDto[];
  criteria: CriterionDto[];
  scores: ScoreDto[];
  sunkCosts: SunkCostDto[];
  advancedSettings: AdvancedSettingsDto;
};

type ContributionDto = {
  criterionId: UUID;
  factorId?: UUID;
  weightedContribution: number;
  explanationKey: string;
};

type SnapshotView = {
  id: UUID;
  decisionId: UUID;
  sourceRevision: number;
  chosenOptionId: UUID;
  schemaVersion: number;
  calculationVersion: string;
  decision: DecisionDraftDto;
  result: EvaluationResult;
  createdAt: ISODateTime;
};

type EvaluationResult = {
  calculationVersion: string;
  evaluatedRevision: number;
  activeAdvancedModules: string[];
  excludedOptions: Array<{ optionId: UUID; failedConstraintIds: UUID[] }>;
  ranking: Array<{
    rank: number;
    optionId: UUID;
    utility: number;
    bestForegoneOptionId?: UUID;
    bestForegoneUtility?: number;
    netAdvantageOverNextBest?: number;
    topPositiveContributions: ContributionDto[];
    topNegativeContributions: ContributionDto[];
  }>;
  stability: {
    level: "stable" | "sensitive" | "insufficient_data";
    testedWeightDelta: number;
    decisiveCriterionIds: UUID[];
  };
  notices: Array<{
    code: string;
    conceptKey: string;
    relatedEntityIds: UUID[];
  }>;
};
```

实现时以与上述 DTO 等价的 Zod schema 作为运行时验证的单一真实来源，并供导入边界复用。不允许从 IndexedDB 类型反向导出公开 DTO。

## 4. 查询契约

### 4.1 `listTemplates()`

- **目的**：获取内置模板列表。
- **输入**：无。
- **返回**：`Result<TemplateSummary[]>`。
- **一致性**：应用版本内不变。
- **错误**：内置内容损坏时 `UNEXPECTED`。

### 4.2 `listDecisions(query?)`

- **目的**：按更新时间倒序返回本地决策。
- **输入**：`{ status?: DecisionStatus; templateId?: string; cursor?: string; limit?: number }`。
- **验证**：`limit` 默认 30，范围 1–100。
- **返回**：`Result<{ items: DecisionSummary[]; nextCursor?: string }>`。
- **一致性**：读取调用开始时的 IndexedDB 快照。
- **错误**：`STORAGE_UNAVAILABLE`。

### 4.3 `getDecision(id)`

- **目的**：读取并迁移一个可编辑决策。
- **输入**：`UUID`。
- **返回**：`Result<DecisionView>`。
- **错误**：`NOT_FOUND`、`IMPORT_VERSION_UNSUPPORTED`、`STORAGE_UNAVAILABLE`。

### 4.4 `getSnapshot(id)` / `listSnapshots(decisionId?)`

- **目的**：读取不可变决策记录。
- **返回**：`Result<SnapshotView>` 或 `Result<SnapshotSummary[]>`。
- **错误**：`NOT_FOUND`、`STORAGE_UNAVAILABLE`。

## 5. 命令契约

### 5.1 `createDecision(command)`

- **目的**：从指定模板创建草稿。
- **输入**：`{ templateId: string; title: string; objective?: string; decisionDate?: ISODate }`。
- **验证**：模板必须存在；标题去空格后 1–120 字符。
- **返回**：`Result<DecisionView>`，初始 `revision=1`。
- **幂等性**：非幂等；每次调用创建新 UUID。UI 在等待时禁用重复提交。
- **错误**：`VALIDATION_FAILED`、`STORAGE_UNAVAILABLE`、`STORAGE_QUOTA_EXCEEDED`。

### 5.2 `updateDecision(command)`

- **目的**：用经过边界验证的完整草稿替换决策聚合的可编辑内容，但不允许 UI 提交 status、chosenOptionId、revision、schema 版本或审计时间。
- **输入**：`{ id: UUID; expectedRevision: number; draft: DecisionDraftDto }`。
- **验证**：验证 schema、引用完整性、ID 唯一性和数值边界等结构安全条件。允许自动保存权重未达 100%、评分未填完等草稿；失败时不保存。
- **返回**：`Result<DecisionView>`，成功时 revision 加 1。
- **幂等性**：同一 `expectedRevision` 只能成功一次；重试返回 `REVISION_CONFLICT`。
- **错误**：`VALIDATION_FAILED`、`NOT_FOUND`、`REVISION_CONFLICT`、存储错误。

### 5.3 `evaluateDecision(input)`

- **目的**：对已保存版本或 UI 中的有效草稿执行纯计算。
- **输入**：`{ decision: DecisionDraftDto; evaluatedRevision: number; calculationVersion?: string }`。
- **验证**：至少 2 个方案、至少 1 个可行方案、启用权重和为 1、评分与情景概率合法。
- **返回**：`Result<EvaluationResult>`。
- **一致性**：相同输入与计算版本逐字段相同；不读取当前时间或存储。
- **幂等性**：完全幂等。
- **错误**：`VALIDATION_FAILED`、`CALCULATION_VERSION_UNSUPPORTED`。

### 5.4 `createSnapshot(command)`

- **目的**：确认选择并原子封存当前决策与结果。
- **输入**：`{ decisionId: UUID; expectedRevision: number; chosenOptionId: UUID }`。
- **验证**：所选方案存在且可行；决策可成功评估。
- **返回**：`Result<{ snapshot: SnapshotView; decision: DecisionView }>`；返回的 Decision 为 `decided`、记录所选方案且 revision 加 1，Snapshot 的 `sourceRevision` 等于该新 revision。
- **幂等性**：非幂等；用户可为同一版本创建多个快照，每个快照有唯一 ID。
- **错误**：`VALIDATION_FAILED`、`NOT_FOUND`、`REVISION_CONFLICT`、计算或存储错误。

### 5.5 `deleteDecision(command)` / `deleteSnapshot(command)`

- **目的**：显式删除本地数据。
- **输入**：Decision 为 `{ id; expectedRevision; snapshotPolicy: "retain" | "delete" }`；Snapshot 为 `{ id }`。
- **返回**：`Result<{ deleted: true }>`。
- **幂等性**：幂等；目标不存在也返回 `deleted: true`。
- **失败一致性**：事务失败时不部分删除。

## 6. 导入导出契约

### 6.1 Export envelope v1

```ts
type PortableDecisionV1 = {
  id: UUID;
  revision: number;
  schemaVersion: number;
  calculationVersion: string;
  status: DecisionStatus;
  chosenOptionId?: UUID;
  draft: DecisionDraftDto;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

type DecisionJudgeExportV1 = {
  format: "decisionjudge-export";
  formatVersion: 1;
  exportedAt: ISODateTime;
  appVersion: string;
  schemaVersion: number;
  decisions: PortableDecisionV1[];
  snapshots: SnapshotView[];
  /** Optional for backwards-compatible v1 readers. */
  presets?: PresetView[];
};
```

`presets` 只包含可复用的方案、评价维度、权重和来源模板信息，不包含本次决策的评分、快照或结果。旧版导出文件没有该字段时按空数组处理。

- **媒体类型**：`application/json; charset=utf-8`。
- **建议文件名**：`decisionjudge-backup-YYYYMMDD-HHmmss.json`。
- **隐私**：包含决策正文，不包含诊断日志、设备标识或未来的 API 密钥。

### 6.2 `exportData(query)`

- **输入**：`{ decisionIds?: UUID[]; includeSnapshots: boolean }`。省略 `decisionIds` 表示全部。
- **返回**：`Result<{ filename: string; mediaType: string; content: string }>`。
- **幂等性**：数据不变时内容除 `exportedAt` 和文件名外相同。

### 6.3 `previewImport(content)`

- **目的**：解析、验证、迁移并显示将要创建或重命名的记录，不写入数据库。
- **输入**：UTF-8 JSON string，MVP 最大 10 MiB。
- **返回**：`Result<ImportPreview>`，包含记录数、迁移、ID 冲突和警告。
- **错误**：`IMPORT_FORMAT_INVALID`、`IMPORT_VERSION_UNSUPPORTED`。

### 6.4 `commitImport(previewToken)`

- **目的**：原子提交已预览的导入计划。
- **输入**：当前页面会话中的短期 `previewToken`；不接受编辑后的原始文本。
- **返回**：`Result<{ importedDecisionIds: UUID[]; importedSnapshotIds: UUID[] }>`。
- **幂等性**：每个 token 只能提交一次；重复提交返回 `VALIDATION_FAILED`。
- **一致性**：所有记录在一个 IndexedDB 事务中写入，失败时全部回滚。

## 7. 领域计算契约

### 7.1 基础效用

```text
criterionScore(option, criterion) =
  directScore
  or sum(enabledFactor.localWeight * factorScore)

baseUtility(option) =
  sum(enabledCriterion.weight * criterionScore)
```

- 所有内部计算使用十进制精度策略，只在 DTO 输出时四舍五入。
- 不可行方案不进入排名。
- 不可收回的沉没成本不进入 `baseUtility`。
- 机会成本是选择某方案时放弃的最佳其他可行方案及其效用，分别输出为 `bestForegoneOptionId` 和 `bestForegoneUtility`，不作为新评分项再次扣分。`netAdvantageOverNextBest` 是当前方案与最佳其他方案的效用差，与机会成本不是同一概念。
- 数值自动换算使用 `score = clamp(1, 10, 1 + 9 * (rawValue - floorValue) / (targetValue - floorValue))`。`higher_is_better` 要求 `targetValue > floorValue`，`lower_is_better` 要求 `targetValue < floorValue`。

### 7.2 高级模块

- 只有模块自身 `enabled=true` 时才参与计算，`advancedUiExpanded` 永不参与计算。
- 情景模块的预期效用为概率加权情景效用。
- 风险模块使用 `downsideDeviation = sqrt(sum(p * max(0, expectedUtility - scenarioUtility)^2))` 和 `riskAdjustedUtility = expectedUtility - aversion * downsideDeviation`。原始预期效用、下行偏差和风险调整必须分别显示。
- 折现只应用于带日期的未来金钱流，使用 `PV = amount / (1 + annualRate) ^ yearFraction`。现值汇总后必须通过关联 Criterion 的 `ValueMappingDto` 换算为评分；未配置换算时只展示现值，不改变排名。
- 敏感性分析每次只将一个启用维度的权重上下调整 `weightDelta`，其他启用权重按原比例归一化。基础模式默认 `weightDelta=0.05`。

## 8. 版本与兼容性

- 应用契约在 MVP 以 TypeScript 包内版本管理；不对外声明 HTTP 稳定性。
- 导出 `formatVersion` 只在不兼容变更时递增。
- `schemaVersion` 管理数据形状，`calculationVersion` 管理计算语义，两者不得混用。
- 旧快照保留封存结果；无法重跑旧计算引擎时仍可读。

## 9. 未来 HTTP/小程序适配限制

未来云端契约必须独立设计认证、授权、同步冲突、幂等、限流、删除和隐私合规。不得将本地 Repository 的持久化实体直接暴露为网络 DTO，也不得假设微信身份等同于业务用户 ID。
