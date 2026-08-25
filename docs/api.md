# DecisionJudge 应用契约

> 状态：待评审  
> 版本：0.1  
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
};
```

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
