import { z } from 'zod'
import type { ResearchRun } from '../types'

const researchRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  createdAt: z.string(),
  progress: z.number().min(0).max(100),
  claims: z.array(z.object({
    id: z.string(),
    index: z.number(),
    statement: z.string(),
    status: z.enum(['verified', 'review', 'conflict']),
    confidence: z.number().min(0).max(1),
    category: z.string(),
    supervisorVerdict: z.string(),
    reviewerVerdict: z.string(),
    conflictReason: z.string().optional(),
    issueType: z.string().optional(),
    evidenceIds: z.array(z.string()),
  })),
  evidence: z.array(z.object({
    id: z.string(),
    title: z.string(),
    publisher: z.string(),
    publishedAt: z.string(),
    locator: z.string(),
    quote: z.string(),
    sourceType: z.string(),
    relation: z.enum(['support', 'challenge']),
    credibility: z.number().min(0).max(1),
  })),
  agents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    status: z.enum(['done', 'running', 'waiting', 'warning']),
    detail: z.string(),
    duration: z.string().optional(),
    restriction: z.string().optional(),
  })),
})

const mockResearchRun = {
  id: 'FS-2026-0726-018',
  title: '宁德时代 2025 年经营质量与海外增长核验',
  company: '宁德时代 · 300750.SZ',
  createdAt: '2026-07-26 14:32',
  progress: 82,
  claims: [
    {
      id: 'claim-1', index: 1, status: 'verified', confidence: 0.94, category: '财务数据',
      statement: '2025 年公司营业收入同比增长 18.2%，海外业务为主要增量来源。',
      supervisorVerdict: '多份一手来源数据一致，收入增速与年报披露相符。',
      reviewerVerdict: '复算结果为 18.17%，四舍五入后成立；海外收入贡献结论可被分部数据支持。',
      evidenceIds: ['ev-1', 'ev-2'],
    },
    {
      id: 'claim-2', index: 2, status: 'verified', confidence: 0.89, category: '市场份额',
      statement: '全球动力电池使用量市场份额连续八年排名第一。',
      supervisorVerdict: '公司公告与第三方行业统计的排名一致。',
      reviewerVerdict: '排名结论成立，但不同机构对市场份额数值存在约 0.6 个百分点差异。',
      evidenceIds: ['ev-3'],
    },
    {
      id: 'claim-3', index: 3, status: 'conflict', confidence: 0.64, category: '盈利质量',
      statement: '毛利率改善主要来自原材料价格下降，而非产品结构优化。',
      supervisorVerdict: '碳酸锂均价下降对成本端形成显著正贡献，初步判断该陈述基本成立。',
      reviewerVerdict: '存在归因过度：高毛利储能业务占比提升与海外客户结构变化同样影响毛利率。',
      conflictReason: '“主要来自”的归因缺少定量拆分。证据能够证明原料价格下降，但不足以排除产品结构贡献。',
      issueType: '归因冲突',
      evidenceIds: ['ev-4', 'ev-5', 'ev-6'],
    },
    {
      id: 'claim-4', index: 4, status: 'review', confidence: 0.57, category: '海外经营',
      statement: '匈牙利工厂将在 2026 年第四季度实现满产。',
      supervisorVerdict: '管理层在业绩说明会中给出投产节奏，但未承诺满产时点。',
      reviewerVerdict: '目前只能确认计划投产，不能确认 2026 年第四季度满产。',
      issueType: '证据缺失',
      evidenceIds: ['ev-7'],
    },
    {
      id: 'claim-5', index: 5, status: 'verified', confidence: 0.91, category: '现金流',
      statement: '经营活动现金流净额连续三年高于归母净利润。',
      supervisorVerdict: '2023—2025 年数据逐年核对成立。',
      reviewerVerdict: '口径一致，未发现异常调整项影响结论。',
      evidenceIds: ['ev-8'],
    },
  ],
  evidence: [
    { id: 'ev-1', title: '2025 年年度报告', publisher: '宁德时代新能源科技股份有限公司', publishedAt: '2026-03-10', locator: '第 26 页 · 主要会计数据', sourceType: '公司公告', relation: 'support', credibility: 0.98, quote: '报告期内，公司实现营业总收入 4,183.6 亿元，同比增长 18.2%；境外地区收入保持快速增长。' },
    { id: 'ev-2', title: '2025 年度业绩说明会记录', publisher: '深圳证券交易所互动易', publishedAt: '2026-03-18', locator: '问题 7 · 海外业务', sourceType: '监管披露', relation: 'support', credibility: 0.93, quote: '欧洲及东南亚客户需求增长，境外业务收入增速高于公司整体水平。' },
    { id: 'ev-3', title: 'Global EV Battery Market 2025', publisher: 'SNE Research', publishedAt: '2026-02-06', locator: 'Table 2 · Global Ranking', sourceType: '行业数据', relation: 'support', credibility: 0.88, quote: 'CATL retained the No.1 position in global EV battery usage for the eighth consecutive year.' },
    { id: 'ev-4', title: '2025 年年度报告', publisher: '宁德时代新能源科技股份有限公司', publishedAt: '2026-03-10', locator: '第 41 页 · 成本分析', sourceType: '公司公告', relation: 'support', credibility: 0.98, quote: '报告期主要原材料价格总体处于较低水平，公司持续推进供应链降本，营业成本增幅低于营业收入增幅。' },
    { id: 'ev-5', title: '碳酸锂价格年度数据', publisher: '上海有色网 SMM', publishedAt: '2026-01-08', locator: '电池级碳酸锂 · 年度均价', sourceType: '大宗数据', relation: 'support', credibility: 0.86, quote: '2025 年电池级碳酸锂年度均价同比下降 21.4%，下半年价格波动区间明显收窄。' },
    { id: 'ev-6', title: '关于产品结构与盈利能力的说明', publisher: '宁德时代投资者关系活动记录', publishedAt: '2026-03-18', locator: '问题 12 · 毛利率', sourceType: '公司公告', relation: 'challenge', credibility: 0.93, quote: '盈利能力提升是技术降本、产品结构优化、海外客户放量及原材料成本改善等多方面共同作用的结果。' },
    { id: 'ev-7', title: '2025 年度业绩说明会记录', publisher: '深圳证券交易所互动易', publishedAt: '2026-03-18', locator: '问题 15 · 欧洲产能', sourceType: '监管披露', relation: 'challenge', credibility: 0.93, quote: '匈牙利项目将根据建设进度与客户需求分阶段释放产能。' },
    { id: 'ev-8', title: '2023—2025 合并现金流量表', publisher: '巨潮资讯网', publishedAt: '2026-03-10', locator: '财务报表 · 现金流量表', sourceType: '监管披露', relation: 'support', credibility: 0.99, quote: '经营活动产生的现金流量净额：2025 年 889.2 亿元；归属于上市公司股东的净利润：642.7 亿元。' },
  ],
  agents: [
    { id: 'supervisor', name: '小盾', role: '负责拆题、汇总和协调', status: 'running', detail: '第一轮已经汇总好，正在等复核结果', duration: '08:42', restriction: '唯一汇聚与判断中心' },
    { id: 'collector', name: '公开信源采集', role: '定向抓取与原文归档', status: 'done', detail: '已归档 12 份公开披露材料', duration: '03:18', restriction: '禁止概括或评价内容' },
    { id: 'parser', name: '文档解析提取', role: 'PDF/OCR 与指标结构化', status: 'done', detail: '已提取 18 条指标及原文坐标', duration: '04:06', restriction: '禁止判断指标合理性' },
    { id: 'retriever', name: '向量证据检索', role: '原文片段与定位检索', status: 'done', detail: '已匹配 24 条可追溯证据', duration: '02:51', restriction: '禁止判断观点真伪' },
    { id: 'scorer', name: '信源可信度打分', role: '来源类型与可信度标注', status: 'done', detail: '已完成 24 个来源分级', duration: '01:42', restriction: '禁止据此判定真假' },
    { id: 'assembler', name: '底稿组装', role: '按模板拼接核验素材', status: 'waiting', detail: '等待双层核验完成后启动', restriction: '禁止增删或撰写观点' },
    { id: 'history', name: '历史情景复盘', role: '历史事件时序查询与客观统计', status: 'waiting', detail: '必备模块，等待研究员手动触发', restriction: '禁止未来判断与观点解读' },
    { id: 'reviewer', name: '独立复核', role: '二次检查事实与证据', status: 'warning', detail: '发现 1 项归因冲突，已告诉小盾', duration: '01:34', restriction: '独立于其他核验任务' },
  ],
} satisfies ResearchRun

export const researchRun = researchRunSchema.parse(mockResearchRun) as ResearchRun

interface VariantRunConfig {
  id: string
  title: string
  company: string
  createdAt: string
  statements: string[]
  evidenceTitle: string
  publisher: string
}

const createVariantRun = (config: VariantRunConfig): ResearchRun => researchRunSchema.parse({
  ...researchRun,
  id: config.id,
  title: config.title,
  company: config.company,
  createdAt: config.createdAt,
  claims: researchRun.claims.map((claim, index) => ({
    ...claim,
    statement: config.statements[index],
    supervisorVerdict: index < 2 || index === 4
      ? '公开披露与复算结果一致，已形成可追溯的原文引用。'
      : '现有材料存在口径边界或证据缺口，需要保留人工判断。',
    reviewerVerdict: index < 2 || index === 4
      ? '独立复核未发现影响结论的口径差异。'
      : '当前证据不足以支持确定性表述，建议限制结论范围。',
    conflictReason: claim.status === 'conflict'
      ? '不同来源对关键归因的表述并不一致，暂时无法确认单一主要原因。'
      : claim.conflictReason,
  })),
  evidence: researchRun.evidence.map((evidence, index) => ({
    ...evidence,
    title: index === 0 ? config.evidenceTitle : `${config.title} · 补充材料 ${index}`,
    publisher: config.publisher,
    quote: index === 0
      ? '报告期数据已经披露，相关指标需结合统计口径、上下文和原始表格进行核对。'
      : '该材料提供了对应主张的原文依据，具体结论仍需与其他公开来源交叉核验。',
  })),
}) as ResearchRun

export const researchRuns: ResearchRun[] = [
  researchRun,
  createVariantRun({
    id: 'FS-2026-0729-031',
    title: '比亚迪 2025 年海外销量与巴西产能核验',
    company: '比亚迪 · 002594.SZ',
    createdAt: '2026-07-29 09:18',
    statements: [
      '2025 年比亚迪海外新能源乘用车销量同比增长 42.6%。',
      '海外销量占公司新能源乘用车总销量的比例首次超过 15%。',
      '海外业务毛利率改善主要来自高端车型占比提升。',
      '巴西工厂将在 2026 年第二季度实现满产。',
      '经营活动现金流净额继续高于归母净利润。',
    ],
    evidenceTitle: '比亚迪 2025 年年度报告',
    publisher: '比亚迪股份有限公司',
  }),
  createVariantRun({
    id: 'FS-2026-0729-029',
    title: '贵州茅台批价走势与渠道库存核验',
    company: '贵州茅台 · 600519.SH',
    createdAt: '2026-07-29 08:46',
    statements: [
      '2025 年直销渠道收入占比继续提升。',
      '合同负债变动与经销商回款节奏基本一致。',
      '飞天茅台批价回落主要由渠道库存上升导致。',
      '公司将在三季度完成全部渠道库存去化。',
      '经营活动现金流与收入增速不存在明显背离。',
    ],
    evidenceTitle: '贵州茅台 2025 年年度报告',
    publisher: '贵州茅台酒股份有限公司',
  }),
  createVariantRun({
    id: 'FS-2026-0725-011',
    title: '新能源汽车产业链政策调整事实核验',
    company: '新能源汽车产业链',
    createdAt: '2026-07-25 16:08',
    statements: [
      '新一轮购置税政策延续了分阶段退坡安排。',
      '动力电池回收责任主体的适用范围已经明确。',
      '本次调整将直接提高所有整车企业的单车利润。',
      '地方配套细则将在 2026 年底前全部落地。',
      '政策原文未改变现行双积分核算周期。',
    ],
    evidenceTitle: '新能源汽车产业政策汇编（2026）',
    publisher: '国务院及相关部委公开文件',
  }),
]
