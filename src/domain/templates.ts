import type { Criterion, TemplateId } from "./types";

export type Template = {
  id: TemplateId;
  name: string;
  description: string;
  concepts: string[];
  criteria: Array<Omit<Criterion, "id"> & { key: string }>;
  starterOptions: Array<{ name: string; description: string; isStatusQuo: boolean }>;
};

export const templates: Template[] = [
  {
    id: "blank",
    name: "空白模板",
    description: "从一个空白画布开始，自己定义方案和评价维度。",
    concepts: ["自定义", "权衡取舍"],
    criteria: [],
    starterOptions: [],
  },
  {
    id: "study-or-work",
    name: "升学还是就业",
    description: "比较继续学习与立即进入职场的长期取舍。",
    concepts: ["机会成本", "沉没成本", "边际收益"],
    criteria: [
      { key: "growth", name: "长期成长", description: "未来 3-5 年的能力、选择空间与发展上限。", weight: 0.3, lowAnchor: "成长路径模糊", highAnchor: "成长空间清晰" },
      { key: "income", name: "经济回报", description: "从现在开始的收入、支出与财务余地。", weight: 0.25, lowAnchor: "现金流压力大", highAnchor: "现金流充足" },
      { key: "fit", name: "个人适配", description: "兴趣、能力、学习方式与生活状态的匹配程度。", weight: 0.2, lowAnchor: "长期难以坚持", highAnchor: "愿意投入且擅长" },
      { key: "risk", name: "风险与确定性", description: "结果波动、退路和对不确定性的承受程度。", weight: 0.15, lowAnchor: "结果高度不确定", highAnchor: "退路与信息充分" },
      { key: "life", name: "生活质量", description: "时间自由、关系、健康和当下生活体验。", weight: 0.1, lowAnchor: "明显挤压生活", highAnchor: "生活状态可持续" },
    ],
    starterOptions: [
      { name: "继续升学", description: "投入时间和学费，换取更系统的知识与未来选择空间。", isStatusQuo: false },
      { name: "直接就业", description: "尽快获得收入与工作经验，在实践中积累资本。", isStatusQuo: false },
      { name: "维持现状", description: "暂不做结构性改变，保留更多观察时间。", isStatusQuo: true },
    ],
  },
  {
    id: "job-change", name: "换工作", description: "比较留任、跳槽或转型的未来增量。", concepts: ["机会成本", "沉没成本"],
    criteria: [
      { key: "growth", name: "职业发展", description: "成长、晋升和行业前景。", weight: 0.3, lowAnchor: "成长停滞", highAnchor: "成长路径清晰" },
      { key: "income", name: "收入与保障", description: "收入、福利和现金流稳定性。", weight: 0.25, lowAnchor: "收入下降且不稳", highAnchor: "收入与保障更好" },
      { key: "fit", name: "工作匹配", description: "工作内容、团队和管理方式。", weight: 0.2, lowAnchor: "长期消耗", highAnchor: "高度匹配" },
      { key: "life", name: "生活影响", description: "通勤、家庭和健康。", weight: 0.15, lowAnchor: "严重影响生活", highAnchor: "明显改善生活" },
      { key: "risk", name: "转换风险", description: "试用期、行业变化和退路。", weight: 0.1, lowAnchor: "退路少", highAnchor: "信息充分且可回退" },
    ],
    starterOptions: [{ name: "接受新机会", description: "", isStatusQuo: false }, { name: "留在当前岗位", description: "", isStatusQuo: true }],
  },
  {
    id: "city-choice", name: "选择城市", description: "从职业、生活与关系的长期组合比较城市。", concepts: ["稀缺性", "机会成本"],
    criteria: [
      { key: "career", name: "职业机会", description: "行业密度与发展空间。", weight: 0.3, lowAnchor: "机会稀少", highAnchor: "机会丰富" },
      { key: "cost", name: "生活成本", description: "住房、通勤与日常支出。", weight: 0.2, lowAnchor: "成本难以承受", highAnchor: "成本可控" },
      { key: "quality", name: "生活质量", description: "环境、公共服务和休闲。", weight: 0.2, lowAnchor: "生活体验差", highAnchor: "长期舒适" },
      { key: "relationship", name: "关系与支持", description: "家人、伴侣和社交网络。", weight: 0.2, lowAnchor: "支持网络薄弱", highAnchor: "支持充分" },
      { key: "flexibility", name: "未来弹性", description: "未来转机和选择空间。", weight: 0.1, lowAnchor: "迁移成本高", highAnchor: "选择空间大" },
    ],
    starterOptions: [{ name: "城市 A", description: "", isStatusQuo: false }, { name: "城市 B", description: "", isStatusQuo: false }, { name: "留在当前城市", description: "", isStatusQuo: true }],
  },
  {
    id: "major-purchase", name: "重大消费或购房", description: "比较购买、租用或延后决定的长期代价。", concepts: ["沉没成本", "时间价值", "机会成本"],
    criteria: [
      { key: "need", name: "实际需求", description: "解决问题的程度与使用频率。", weight: 0.3, lowAnchor: "需求不明确", highAnchor: "高频且刚需" },
      { key: "cost", name: "总成本", description: "一次性和持续性成本。", weight: 0.25, lowAnchor: "超出承受能力", highAnchor: "长期成本可控" },
      { key: "quality", name: "品质收益", description: "舒适度、可靠性和体验提升。", weight: 0.2, lowAnchor: "改善有限", highAnchor: "明显改善" },
      { key: "flexibility", name: "流动性", description: "转售、替代和退出的容易程度。", weight: 0.15, lowAnchor: "退出困难", highAnchor: "灵活可退" },
      { key: "risk", name: "不确定性", description: "价格、维护和未来需求变化。", weight: 0.1, lowAnchor: "风险难估", highAnchor: "风险可控" },
    ],
    starterOptions: [{ name: "购买", description: "", isStatusQuo: false }, { name: "租用或选择替代品", description: "", isStatusQuo: false }, { name: "延后决定", description: "", isStatusQuo: true }],
  },
];
