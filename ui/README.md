# FactShield UI

面向金融研究的 Supervisor–SubAgent 事实溯源与双层核验工作台前端原型。

## 本地运行

```powershell
cd ui
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

## 当前实现

- React 19 + TypeScript + Vite
- Ant Design 组件与自定义研究工作台视觉系统
- Zustand 页面状态管理
- TanStack Query Mock 数据请求层
- Zod 接口数据运行时校验
- React Flow Supervisor–SubAgent 拓扑
- ECharts 研究质量分析
- 可切换 Claim、证据原文与双层核验结论
- 可模拟 Agent 执行进度
- 任务创建与历史任务 UI 原型（不实际上传文件）
- 5 个原子 SubAgent 的受控拓扑展示（仅 Mock 可视化）
- 多源依据并排对比、重新取证流程弹窗和全链路审计抽屉
- 常驻研究合规提示与“可信 / 待复核 / 高度存疑”三色标签
- 历史情景复盘 SubAgent UI：由研究员手动触发，包含客观时序图、样本来源表与底稿附件

`src/services/mockApi.ts` 当前提供模拟接口。后端完成后，可以保留页面组件并将这里替换为真实 HTTP/SSE 服务。
