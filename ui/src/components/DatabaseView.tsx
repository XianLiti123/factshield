import { useMemo, useState, type ReactNode } from 'react'
import {
  ApiOutlined,
  ArrowUpOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { Button, Empty, Input, Spin, Tag, message } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { streamChat, type StreamEvent } from '../services/api'

type ChannelKey = 'web' | 'source' | 'database'

type DatabaseQueryRecord = {
  id: number
  query: string
  answer: string
  tools: string[]
  createdAt: string
}

type ChannelMeta = {
  title: string
  description: string
  icon: ReactNode
  tone: string
}

const CHANNEL_META: Record<ChannelKey, ChannelMeta> = {
  web: {
    title: '网络检索',
    description: '公开网页、公告与新闻',
    icon: <SearchOutlined />,
    tone: 'web',
  },
  source: {
    title: '数据源检索',
    description: '金融数据源与已接入服务',
    icon: <ApiOutlined />,
    tone: 'source',
  },
  database: {
    title: '数据库检索',
    description: '历史研究与本地知识库',
    icon: <DatabaseOutlined />,
    tone: 'database',
  },
}

const CHANNEL_KEYS: ChannelKey[] = ['web', 'source', 'database']
const HISTORY_KEY_PREFIX = 'factshield.database-search.'

const EXAMPLES = [
  '梳理宁德时代近三年的海外扩张和盈利变化',
  '比较新能源车行业今年的销量与价格趋势',
  '查找过去类似政策落地后的市场表现',
]

function loadHistory(userId: number): DatabaseQueryRecord[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(`${HISTORY_KEY_PREFIX}${userId}`) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is DatabaseQueryRecord => Boolean(item)
      && typeof item === 'object'
      && typeof (item as DatabaseQueryRecord).id === 'number'
      && typeof (item as DatabaseQueryRecord).query === 'string'
      && typeof (item as DatabaseQueryRecord).answer === 'string')
  } catch {
    return []
  }
}

function saveHistory(userId: number, records: DatabaseQueryRecord[]) {
  try {
    window.localStorage.setItem(`${HISTORY_KEY_PREFIX}${userId}`, JSON.stringify(records.slice(0, 8)))
  } catch {
    // The current result remains available in memory when browser storage is unavailable.
  }
}

function channelForTool(tool: string): ChannelKey | null {
  const normalized = tool.toLowerCase()
  if (/web_search|web_extract|search|网页|网络/.test(normalized)) return 'web'
  if (/finance|efinance|tickflow|data_source|datasource|数据源|行情|财务/.test(normalized)) return 'source'
  if (/memory|recall|advanced_research|knowledge|database|数据库|知识库|记忆/.test(normalized)) return 'database'
  return null
}

function splitAnswer(answer: string): Record<ChannelKey, string> {
  const result: Record<ChannelKey, string> = { web: '', source: '', database: '' }
  const heading = /(?:^|\n)\s{0,3}#{1,4}\s*(?:\d+[.、)]?\s*)?(网络检索|网络信息|数据源检索|数据源信息|数据库检索|数据库信息)\s*[:：]?\s*(?=\n|$)/g
  const sections = [...answer.matchAll(heading)]
  const headingToChannel = (value: string): ChannelKey => value.startsWith('网络')
    ? 'web'
    : value.startsWith('数据源') ? 'source' : 'database'

  if (sections.length === 0) {
    result.web = answer
    return result
  }

  sections.forEach((section, index) => {
    const start = (section.index ?? 0) + section[0].length
    const end = index + 1 < sections.length ? (sections[index + 1].index ?? answer.length) : answer.length
    result[headingToChannel(section[1])] = answer.slice(start, end).trim()
  })
  return result
}

function buildSearchPrompt(query: string) {
  return `你是 FactShield 的三路资料检索助手。请围绕下面的问题进行真实检索，并把结果整理成可核对的事实：

研究问题：${query}

请按下面三个一级标题严格输出，三个标题都必须保留，不要合并：
## 网络检索
检索公开网页、公告、新闻或机构报告，列出关键事实、日期和来源；无法联网时说明原因。

## 数据源检索
优先使用已接入的金融数据源或其他服务，列出指标、口径、时间范围和返回值；没有可用数据源时明确说明。

## 数据库检索
检索历史研究、知识库或本地资料，列出匹配内容和可追溯线索；没有匹配时明确说明。

每部分都要区分“查到的内容”和“限制”，不要编造数据。最后可补充一段简短的交叉核对结论。`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function DatabaseView({ userId }: { userId: number }) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [thinking, setThinking] = useState('')
  const [tools, setTools] = useState<string[]>([])
  const [history, setHistory] = useState<DatabaseQueryRecord[]>(() => loadHistory(userId))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedTools, setExpandedTools] = useState<ChannelKey | null>(null)

  const sections = useMemo(() => splitAnswer(answer), [answer])
  const channelTools = useMemo(() => CHANNEL_KEYS.reduce<Record<ChannelKey, string[]>>((result, key) => {
    result[key] = tools.filter((tool) => channelForTool(tool) === key)
    return result
  }, { web: [], source: [], database: [] }), [tools])

  const restoreRecord = (record: DatabaseQueryRecord) => {
    setQuery(record.query)
    setSubmittedQuery(record.query)
    setAnswer(record.answer)
    setTools(record.tools)
    setThinking('')
    setError('')
  }

  const runSearch = async () => {
    const normalized = query.trim()
    if (!normalized || loading) return
    setSubmittedQuery(normalized)
    setAnswer('')
    setThinking('')
    setTools([])
    setExpandedTools(null)
    setError('')
    setLoading(true)
    let streamedAnswer = ''
    const streamedTools: string[] = []

    try {
      await streamChat(buildSearchPrompt(normalized), `database-${userId}`, userId, (event: StreamEvent) => {
        if (event.type === 'token') {
          streamedAnswer += event.content
          setAnswer((current) => current + event.content)
        }
        if (event.type === 'think') setThinking((current) => current + event.content)
        if (event.type === 'tool') {
          if (!streamedTools.includes(event.content)) streamedTools.push(event.content)
          setTools((current) => current.includes(event.content) ? current : [...current, event.content])
        }
        if (event.type === 'error') throw new Error(event.content || '检索失败')
      })

      if (streamedAnswer.trim()) {
        const record: DatabaseQueryRecord = {
          id: Date.now(),
          query: normalized,
          answer: streamedAnswer,
          tools: streamedTools,
          createdAt: new Date().toISOString(),
        }
        setHistory((previous) => {
          const next = [record, ...previous.filter((item) => item.query !== normalized)]
          saveHistory(userId, next)
          return next.slice(0, 8)
        })
      }
      message.success('三路检索已完成')
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : '检索失败，请稍后重试'
      setError(detail)
      message.error(detail)
    } finally {
      setLoading(false)
    }
  }

  const hasAnyResult = Boolean(answer.trim() || thinking.trim() || tools.length)

  return (
    <div className="database-page">
      <section className="database-query-card page-card">
        <div className="database-query-intro">
          <div className="database-query-icon"><DatabaseOutlined /></div>
          <div>
            <span className="database-eyebrow">三路检索工作台</span>
            <h2>把一个问题，交给三种资料来源一起查</h2>
            <p>小盾会根据问题选择网络、已接入数据源和历史知识库，再把结果并列放在这里。</p>
          </div>
          <Tag icon={<CheckCircleFilled />}>调用 Agent 检索</Tag>
        </div>
        <div className="database-query-form">
          <Input.TextArea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault()
                void runSearch()
              }
            }}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="输入你想核对的问题，例如：宁德时代近三年的海外扩张是否带来盈利改善？"
          />
          <div className="database-query-actions">
            <span>Enter 检索 · Shift + Enter 换行</span>
            <Button type="primary" icon={<ArrowUpOutlined />} loading={loading} disabled={!query.trim()} onClick={() => void runSearch()}>开始检索</Button>
          </div>
        </div>
        <div className="database-examples">
          <span>可以这样问</span>
          {EXAMPLES.map((example) => <button type="button" key={example} onClick={() => setQuery(example)}>{example}</button>)}
        </div>
      </section>

      {error && <div className="database-error"><ReloadOutlined /><span>{error}</span><Button size="small" onClick={() => void runSearch()}>重试</Button></div>}

      <section className="database-results-section">
        <div className="database-section-heading">
          <div><span>检索结果</span><strong>{submittedQuery ? `关于“${submittedQuery}”` : '等待输入研究问题'}</strong></div>
          {loading && <span className="database-running"><i /> 正在同步三路资料</span>}
        </div>
        {!hasAnyResult && !loading ? (
          <div className="database-empty page-card"><DatabaseOutlined /><strong>还没有检索结果</strong><span>从上面的输入框开始，结果会按三类资料分别显示。</span></div>
        ) : (
          <div className="database-channel-grid">
            {CHANNEL_KEYS.map((key) => {
              const meta = CHANNEL_META[key]
              const content = sections[key]
              const liveContent = content || (loading && key === 'web' ? answer : '')
              return (
                <article className={`database-channel-card ${meta.tone}`} key={key}>
                  <header>
                    <span className="database-channel-icon">{meta.icon}</span>
                    <div><strong>{meta.title}</strong><small>{meta.description}</small></div>
                    <span className={`database-channel-status${loading ? ' loading' : ''}`}>{loading ? <Spin size="small" /> : <CheckCircleFilled />} {loading ? '检索中' : '已返回'}</span>
                  </header>
                  {channelTools[key].length > 0 && (
                    <div className={`database-tool-card${expandedTools === key ? ' expanded' : ''}`}>
                      <button type="button" className="database-tool-toggle" onClick={() => setExpandedTools((current) => current === key ? null : key)} aria-expanded={expandedTools === key}>
                        <span><ToolOutlined /><strong>调用工具</strong><small>{channelTools[key].length} 项</small></span>
                        <i />
                      </button>
                      {expandedTools === key && <div className="database-tool-list">{channelTools[key].map((tool) => <span key={tool}><ToolOutlined /> {tool}</span>)}</div>}
                    </div>
                  )}
                  <div className="database-channel-content">
                    {liveContent ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveContent}</ReactMarkdown> : loading ? <div className="database-channel-placeholder"><Spin /><span>等待模型返回这一类资料…</span></div> : <p>模型没有返回明确的分段内容，请查看其他结果或重新提问。</p>}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {thinking && <details className="database-thinking page-card"><summary><ClockCircleOutlined /> 查看本次检索的思考过程</summary><div><ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking}</ReactMarkdown></div></details>}

      <section className="database-history-section">
        <div className="database-section-heading"><div><span>最近检索</span><strong>保留在当前账号的浏览器中</strong></div></div>
        {history.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有历史检索" /> : <div className="database-history-list">{history.map((record) => <button type="button" key={record.id} onClick={() => restoreRecord(record)}><span><SearchOutlined /><strong>{record.query}</strong></span><small>{formatTime(record.createdAt)}</small></button>)}</div>}
      </section>
    </div>
  )
}
