# FactShield

#### 介绍
{**以下是 Gitee 平台说明，您可以替换此简介**
Gitee 是 OSCHINA 推出的基于 Git 的代码托管平台（同时支持 SVN）。专为开发者提供稳定、高效、安全的云端软件开发协作平台
无论是个人、团队、或是企业，都能够用 Gitee 实现代码托管、项目管理、协作开发。企业项目请看 [https://gitee.com/enterprises](https://gitee.com/enterprises)}

#### 软件架构
##### agent层
agent/
├── core/           ← 引擎层（Agent 循环 / 图执行引擎）
│   ├── loop.py     ← 主循环
│   └── runner.py   ← 任务执行器
├── state/          ← 状态管理
│   ├── base.py     ← 状态基类
│   └── reducer.py  ← 合并策略
├── tools/          ← 工具层（扁平，每个文件一个工具）
│   ├── web_search.py
│   └── terminal.py
├── llm/            ← LLM 调用层
│   └── client.py   ← 封装 OpenAI / Anthropic 等
├── memory/         ← 记忆层
│   └── store.py
├── agent.py        ← 对外入口（用户只 import 这个）
└── config.py       ← 配置

##### UI层
UI/

#### 安装教程

1.  安装 Python 依赖：`pip install -r requirements.txt`
2.  在项目根目录创建 `.env` 文件，配置以下环境变量：

    **必填：**
    ```
    DEEPSEEK-API-KEY=sk-xxx        # DeepSeek 大模型的 API key（注意变量名中是连字符）
    TAVILY_API_KEY=tvly-xxx        # Tavily 联网搜索的 API key
    ```

    **可选（配置后启用 AI 高精度识别图片/扫描版 PDF 功能）：**
    ```
    VISION_API_KEY=sk-xxx          # 视觉模型的 API key
    VISION_BASE_URL=https://...    # 视觉模型的 OpenAI 兼容接口地址
    VISION_MODEL=qwen-vl-max       # 视觉模型名称
    ```
    视觉模型可使用任意 OpenAI 兼容的多模态服务（如通义千问 qwen-vl、智谱 glm-4v、OpenAI gpt-4o 等）；不配置时其他功能不受影响。

#### 使用说明

1.  xxxx
2.  xxxx
3.  xxxx

#### 参与贡献

1.  Fork 本仓库
2.  新建 Feat_xxx 分支
3.  提交代码
4.  新建 Pull Request


#### 特技

1.  使用 Readme\_XXX.md 来支持不同的语言，例如 Readme\_en.md, Readme\_zh.md
2.  Gitee 官方博客 [blog.gitee.com](https://blog.gitee.com)
3.  你可以 [https://gitee.com/explore](https://gitee.com/explore) 这个地址来了解 Gitee 上的优秀开源项目
4.  [GVP](https://gitee.com/gvp) 全称是 Gitee 最有价值开源项目，是综合评定出的优秀开源项目
5.  Gitee 官方提供的使用手册 [https://gitee.com/help](https://gitee.com/help)
6.  Gitee 封面人物是一档用来展示 Gitee 会员风采的栏目 [https://gitee.com/gitee-stars/](https://gitee.com/gitee-stars/)
