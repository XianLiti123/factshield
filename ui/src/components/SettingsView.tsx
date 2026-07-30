import { useEffect, useMemo, useState } from 'react'
import {
  ApiOutlined,
  AppstoreOutlined,
  CheckCircleFilled,
  CloseOutlined,
  CodeOutlined,
  CompressOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'
import { Button, Input, Modal, Segmented, Select, Slider, Switch, Tag, message } from 'antd'
import { getCapabilities, getSettings, saveModelConfig, type CapabilityStatus } from '../services/api'

type ModelConfig = {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  modelName: string
}

type ModelSlotId = 'primary' | 'vision' | 'embedding' | 'reranker'

type ModelSlot = {
  id: ModelSlotId
  name: string
  description: string
  mark: string
  models: ModelConfig[]
  selectedModelId: string
}

type SearchEngine = {
  id: string
  name: string
  description: string
  apiKey: string
  requiresApiKey: boolean
}

type DataSourceMode = 'http' | 'python'
type DataSourceConfig = { id: string; name: string; description: string; category: string; mode: DataSourceMode; specification: string; enabled: boolean }

const initialSlots: ModelSlot[] = [
  {
    id: 'primary',
    name: '主 LLM',
    description: '研究规划、事实研判与内容生成',
    mark: 'LLM',
    selectedModelId: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'OpenAI 兼容接口', baseUrl: 'https://api.deepseek.com', apiKey: '', modelName: 'deepseek-chat' },
      { id: 'qwen-plus', name: '通义千问 Plus', provider: 'OpenAI 兼容接口', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', modelName: 'qwen-plus' },
    ],
  },
  {
    id: 'vision',
    name: '视觉大模型',
    description: '图表、扫描件与图片内容理解',
    mark: 'VIS',
    selectedModelId: 'qwen-vl-max',
    models: [
      { id: 'qwen-vl-max', name: '通义千问 VL Max', provider: 'OpenAI 兼容接口', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', modelName: 'qwen-vl-max' },
      { id: 'gpt-4o-vision', name: 'GPT-4o', provider: 'OpenAI 接口', baseUrl: 'https://api.openai.com/v1', apiKey: '', modelName: 'gpt-4o' },
    ],
  },
  {
    id: 'embedding',
    name: 'Embedding 模型',
    description: '文档向量化与语义检索',
    mark: 'EMB',
    selectedModelId: 'text-embedding-v3',
    models: [
      { id: 'text-embedding-v3', name: 'Text Embedding V3', provider: 'OpenAI 兼容接口', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', modelName: 'text-embedding-v3' },
      { id: 'bge-m3', name: 'BGE-M3', provider: '自定义兼容接口', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '', modelName: 'BAAI/bge-m3' },
    ],
  },
  {
    id: 'reranker',
    name: 'Reranker 模型',
    description: '召回结果重排与相关性筛选',
    mark: 'RER',
    selectedModelId: 'bge-reranker-v2-m3',
    models: [
      { id: 'bge-reranker-v2-m3', name: 'BGE Reranker v2', provider: '自定义兼容接口', baseUrl: 'http://127.0.0.1:8001/v1', apiKey: '', modelName: 'BAAI/bge-reranker-v2-m3' },
      { id: 'jina-reranker-v2', name: 'Jina Reranker v2', provider: 'Jina AI 接口', baseUrl: 'https://api.jina.ai/v1', apiKey: '', modelName: 'jina-reranker-v2-base-multilingual' },
    ],
  },
]

const initialSearchEngines: SearchEngine[] = [
  { id: 'tavily', name: 'Tavily', description: '面向 AI 研究任务的结构化搜索', apiKey: '', requiresApiKey: true },
  { id: 'python', name: 'Python', description: '通过本地 Python 检索流程执行，无需 API Key', apiKey: '', requiresApiKey: false },
]

const DATA_SOURCES_KEY = 'factshield.settings.data-sources.v2'
const presetDataSources: DataSourceConfig[] = [
  { id: 'efinance', name: 'efinance', description: '已接入的 A 股行情与基础金融数据 SDK', category: '已接入数据源', mode: 'python', specification: "import efinance as ef\n\n# 获取股票历史行情\ndf = ef.stock.get_quote_history('000001')", enabled: true },
  { id: 'tickflow', name: 'TickFlow', description: '已接入的行情与逐笔数据服务', category: '已接入数据源', mode: 'python', specification: "# TickFlow 已由服务端连接器接入\n# 调用入口、鉴权与返回结构由服务端统一管理\n# 前端仅维护启用状态，不在浏览器中执行代码", enabled: true },
  { id: 'wind', name: '万得金融数据服务', description: '专业金融市场、公司与宏观数据', category: '金融数据库', mode: 'python', specification: "from WindPy import w\nw.start()\nresult = w.wsd('000001.SZ', 'close', '2026-01-01', '2026-01-31')", enabled: false },
  { id: 'tushare', name: 'Tushare Pro', description: '证券、基金、期货与宏观数据接口', category: '金融数据库', mode: 'python', specification: "import tushare as ts\npro = ts.pro_api('YOUR_TOKEN')\ndf = pro.daily(ts_code='000001.SZ')", enabled: false },
  { id: 'akshare', name: 'AKShare', description: '开源财经数据接口库', category: '金融数据库', mode: 'python', specification: "import akshare as ak\ndf = ak.stock_zh_a_hist(symbol='000001')", enabled: false },
  { id: 'custom-http', name: '自定义 HTTP 数据源', description: '连接内部或第三方数据服务', category: '自定义', mode: 'http', specification: "GET https://api.example.com/v1/market/data\nAuthorization: Bearer ${API_KEY}\nQuery: symbol, start_date, end_date\nResponse data path: $.data", enabled: false },
]
function loadDataSources() {
  try {
    const raw = window.localStorage.getItem(DATA_SOURCES_KEY)
    if (raw === null) return presetDataSources
    const stored = JSON.parse(raw)
    return Array.isArray(stored) ? stored as DataSourceConfig[] : presetDataSources
  }
  catch { return presetDataSources }
}

const DEFAULT_CONTEXT_TRIGGER = 80
const CONTEXT_PREFERENCE_KEY = 'factshield.settings.context-compaction'

function loadContextPreference() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONTEXT_PREFERENCE_KEY) ?? '{}') as {
      custom?: boolean
      trigger?: number
    }
    return {
      custom: Boolean(stored.custom),
      trigger: typeof stored.trigger === 'number'
        ? Math.min(100, Math.max(0, Math.round(stored.trigger)))
        : DEFAULT_CONTEXT_TRIGGER,
    }
  } catch {
    return { custom: false, trigger: DEFAULT_CONTEXT_TRIGGER }
  }
}

export function SettingsView() {
  const initialContextPreference = useMemo(loadContextPreference, [])
  const [slots, setSlots] = useState<ModelSlot[]>(initialSlots)
  const [activeSlotId, setActiveSlotId] = useState<ModelSlotId>('primary')
  const [deepThinking, setDeepThinking] = useState(true)
  const [showModelApiKey, setShowModelApiKey] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>(initialSearchEngines)
  const [activeSearchEngineId, setActiveSearchEngineId] = useState(initialSearchEngines[0].id)
  const [showSearchApiKey, setShowSearchApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [capabilities, setCapabilities] = useState<CapabilityStatus | null>(null)
  const [customContextTrigger, setCustomContextTrigger] = useState(initialContextPreference.custom)
  const [contextTrigger, setContextTrigger] = useState(initialContextPreference.trigger)
  const [dataSources, setDataSources] = useState<DataSourceConfig[]>(loadDataSources)
  const [dataSourceModalOpen, setDataSourceModalOpen] = useState(false)
  const [activeDataSourceId, setActiveDataSourceId] = useState(presetDataSources[0].id)
  const [deleteDataSourceTarget, setDeleteDataSourceTarget] = useState<DataSourceConfig | null>(null)

  useEffect(() => {
    getSettings().then((settings) => {
      setSlots((current) => current.map((slot) => {
        const serverSlot = slot.id === 'primary' ? 'llm' : slot.id === 'vision' ? 'vision' : null
        const config = serverSlot ? settings.configs[serverSlot] : undefined
        if (!config) return slot
        const selected = slot.models.find((model) => model.modelName === config.model_name) ?? slot.models[0]
        return {
          ...slot,
          selectedModelId: selected.id,
          models: slot.models.map((model) => model.id === selected.id ? {
            ...model,
            baseUrl: config.base_url,
            apiKey: config.api_key,
            modelName: config.model_name,
          } : model),
        }
      }))
    }).catch((error) => message.error(error instanceof Error ? error.message : '设置加载失败'))
    getCapabilities().then(setCapabilities).catch(() => setCapabilities(null))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(CONTEXT_PREFERENCE_KEY, JSON.stringify({
      custom: customContextTrigger,
      trigger: contextTrigger,
    }))
  }, [contextTrigger, customContextTrigger])

  useEffect(() => {
    window.localStorage.setItem(DATA_SOURCES_KEY, JSON.stringify(dataSources))
  }, [dataSources])

  const activeSlot = useMemo(
    () => slots.find((slot) => slot.id === activeSlotId) ?? slots[0],
    [activeSlotId, slots],
  )
  const selectedModel = useMemo(
    () => activeSlot.models.find((model) => model.id === activeSlot.selectedModelId) ?? activeSlot.models[0],
    [activeSlot],
  )
  const activeSearchEngine = useMemo(
    () => searchEngines.find((engine) => engine.id === activeSearchEngineId) ?? searchEngines[0],
    [activeSearchEngineId, searchEngines],
  )
  const isPersonalSlot = activeSlot.id === 'primary' || activeSlot.id === 'vision'
  const activeDataSource = dataSources.find((source) => source.id === activeDataSourceId) ?? dataSources[0]
  const updateActiveDataSource = (patch: Partial<DataSourceConfig>) => setDataSources((current) => current.map((source) => source.id === activeDataSourceId ? { ...source, ...patch } : source))
  const addCustomDataSource = () => {
    const id = `source-${Date.now()}`
    setDataSources((current) => [...current, { id, name: '未命名数据源', description: '填写接口规范后交由服务端连接', category: '自定义', mode: 'http', specification: '', enabled: false }])
    setActiveDataSourceId(id)
  }
  const removeActiveDataSource = () => {
    if (!activeDataSource) return
    setDeleteDataSourceTarget(activeDataSource)
  }
  const confirmRemoveDataSource = () => {
    if (!deleteDataSourceTarget) return
    const removedIndex = dataSources.findIndex((source) => source.id === deleteDataSourceTarget.id)
    const remaining = dataSources.filter((source) => source.id !== deleteDataSourceTarget.id)
    window.localStorage.setItem(DATA_SOURCES_KEY, JSON.stringify(remaining))
    setDataSources(remaining)
    setActiveDataSourceId(remaining[Math.min(removedIndex, remaining.length - 1)]?.id ?? '')
    message.success(`已删除“${deleteDataSourceTarget.name}”`)
    setDeleteDataSourceTarget(null)
  }

  const updateSelectedModel = (key: keyof ModelConfig, value: string) => {
    setSlots((current) => current.map((slot) => slot.id === activeSlotId
      ? { ...slot, models: slot.models.map((model) => model.id === slot.selectedModelId ? { ...model, [key]: value } : model) }
      : slot))
  }

  const selectModelForActiveSlot = (modelId: string) => {
    setSlots((current) => current.map((slot) => slot.id === activeSlotId ? { ...slot, selectedModelId: modelId } : slot))
    setShowModelApiKey(false)
  }

  const addModel = () => {
    const name = newModelName.trim()
    if (!name) return
    const id = `${activeSlotId}-${Date.now()}`
    setSlots((current) => current.map((slot) => slot.id === activeSlotId
      ? {
          ...slot,
          selectedModelId: id,
          models: [...slot.models, { id, name, provider: 'OpenAI 兼容接口', baseUrl: '', apiKey: '', modelName: '' }],
        }
      : slot))
    setNewModelName('')
    setAddModalOpen(false)
  }

  const removeSelectedModel = () => {
    if (activeSlot.models.length === 1) {
      message.warning(`${activeSlot.name}至少保留一个模型`)
      return
    }
    const nextModels = activeSlot.models.filter((model) => model.id !== activeSlot.selectedModelId)
    setSlots((current) => current.map((slot) => slot.id === activeSlotId
      ? { ...slot, models: nextModels, selectedModelId: nextModels[0].id }
      : slot))
  }

  const updateSearchApiKey = (apiKey: string) => {
    setSearchEngines((current) => current.map((engine) => engine.id === activeSearchEngineId ? { ...engine, apiKey } : engine))
  }

  const saveSettings = async () => {
    if (!selectedModel.baseUrl.trim() || !selectedModel.modelName.trim()) {
      message.warning(`请补全${activeSlot.name}的 Base URL 和模型名称`)
      return
    }
    if (activeSlot.id !== 'primary' && activeSlot.id !== 'vision') {
      message.info(`${activeSlot.name}当前由服务端环境统一配置，页面只显示连接状态`)
      return
    }
    const maskedKey = selectedModel.apiKey.includes('...') || selectedModel.apiKey === '***'
    if (maskedKey || !selectedModel.apiKey.trim()) {
      message.warning('请输入新的 API Key 后再保存；服务端不会回传已保存的明文密钥')
      return
    }
    setSaving(true)
    try {
      await saveModelConfig(activeSlot.id === 'primary' ? 'llm' : 'vision', {
        base_url: selectedModel.baseUrl.trim(),
        model_name: selectedModel.modelName.trim(),
        api_key: selectedModel.apiKey.trim(),
      })
      message.success(`${activeSlot.name}已加密保存`)
      const settings = await getSettings()
      const config = settings.configs[activeSlot.id === 'primary' ? 'llm' : 'vision']
      if (config) updateSelectedModel('apiKey', config.api_key)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-page">
      <aside className="settings-side-column">
      <section className="settings-model-panel page-card">
        <div className="settings-panel-heading">
          <div><span>独立模型分配</span><strong>模型用途</strong></div>
          <Tag>2 个个人配置 · 2 个全局能力</Tag>
        </div>

        <div className="settings-slot-list">
          {slots.map((slot) => {
            const currentModel = slot.models.find((model) => model.id === slot.selectedModelId)
            return (
              <button className={activeSlotId === slot.id ? 'settings-slot-item active' : 'settings-slot-item'} key={slot.id} onClick={() => {
                setActiveSlotId(slot.id)
                setShowModelApiKey(false)
              }}>
                <span className="settings-slot-mark">{slot.mark}</span>
                <span><strong>{slot.name}</strong><small>{currentModel?.name}</small></span>
                <i />
              </button>
            )
          })}
        </div>

        <div className="settings-model-tip">
          <SafetyCertificateOutlined />
          <span>主 LLM 与视觉模型按账号加密保存；Embedding 和 Reranker 由服务端统一配置。</span>
        </div>
      </section>
      <button type="button" className="settings-data-source-entry page-card" onClick={() => setDataSourceModalOpen(true)}>
        <span><AppstoreOutlined /></span><div><strong>数据源管理</strong><small>{dataSources.filter((source) => source.enabled).length} 个已启用 · HTTP / Python SDK</small></div><i>管理</i>
      </button>
      </aside>

      <div className="settings-content-column">
        <section className="settings-form-card page-card">
          <div className="settings-form-header">
            <div className="settings-selected-model">
              <span>{activeSlot.mark}</span>
              <div><strong>{activeSlot.name}</strong><small>{activeSlot.description}</small></div>
            </div>
            <div className="settings-form-header-actions">
              {activeSlot.id === 'primary' && (
                <label className="settings-inline-thinking">
                  <span><ThunderboltFilled /></span>
                  <div><strong>深度思考</strong><small>支持推理模式时启用</small></div>
                  <Switch size="small" checked={deepThinking} onChange={setDeepThinking} />
                </label>
              )}
              <Tag icon={<CheckCircleFilled />}>独立配置</Tag>
            </div>
          </div>

          <div className="settings-model-selector-row">
            <label>
              <span>当前使用模型</span>
              <Select
                value={activeSlot.selectedModelId}
                options={activeSlot.models.map((model) => ({ value: model.id, label: model.name }))}
                onChange={selectModelForActiveSlot}
              />
            </label>
            <Button icon={<PlusOutlined />} disabled={!isPersonalSlot} onClick={() => setAddModalOpen(true)}>添加候选模型</Button>
            <Button danger type="text" disabled={!isPersonalSlot} icon={<DeleteOutlined />} onClick={removeSelectedModel}>删除当前</Button>
          </div>

          <div className="settings-form-grid compact">
            <label className="settings-field">
              <span className="settings-field-label">配置名称</span>
              <Input disabled={!isPersonalSlot} value={selectedModel.name} onChange={(event) => updateSelectedModel('name', event.target.value)} placeholder="例如：DeepSeek Chat" />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">模型名称</span>
              <Input disabled={!isPersonalSlot} value={selectedModel.modelName} onChange={(event) => updateSelectedModel('modelName', event.target.value)} placeholder="例如：deepseek-chat" />
            </label>
            <label className="settings-field full">
              <span className="settings-field-label">Base URL</span>
              <Input disabled={!isPersonalSlot} prefix={<ApiOutlined />} value={selectedModel.baseUrl} onChange={(event) => updateSelectedModel('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" />
            </label>
            <label className="settings-field full">
              <span className="settings-field-label">API Key</span>
              <Input
                prefix={<SafetyCertificateOutlined />}
                disabled={!isPersonalSlot}
                suffix={<button className="settings-key-visibility" type="button" aria-label={showModelApiKey ? '隐藏模型 API Key' : '显示模型 API Key'} onClick={() => setShowModelApiKey((current) => !current)}>{showModelApiKey ? <EyeOutlined /> : <EyeInvisibleOutlined />}</button>}
                type={showModelApiKey ? 'text' : 'password'}
                value={selectedModel.apiKey}
                onChange={(event) => updateSelectedModel('apiKey', event.target.value)}
                placeholder={`输入${activeSlot.name}的 API Key`}
              />
            </label>
          </div>

          {activeSlot.id === 'primary' && (
            <div className={`settings-inline-context${customContextTrigger ? ' custom' : ''}`}>
              <div className="settings-inline-context-copy">
                <span><CompressOutlined /></span>
                <div><strong>上下文自动整理</strong><p>接近窗口上限时整理较早内容，保留关键结论和未完成事项。</p></div>
              </div>
              <div className="settings-inline-context-control">
                <div className="settings-context-toggle">
                  <div>
                    <strong>自定义触发比例</strong>
                    <span>{customContextTrigger ? `达到 ${contextTrigger}% 时开始整理` : `使用系统默认 ${DEFAULT_CONTEXT_TRIGGER}%`}</span>
                  </div>
                  <Switch size="small" checked={customContextTrigger} onChange={setCustomContextTrigger} />
                </div>
                <div className="settings-context-slider">
                  <div><span>触发比例</span><strong>{customContextTrigger ? contextTrigger : DEFAULT_CONTEXT_TRIGGER}%</strong></div>
                  <Slider
                    min={0}
                    max={100}
                    value={customContextTrigger ? contextTrigger : DEFAULT_CONTEXT_TRIGGER}
                    disabled={!customContextTrigger}
                    onChange={setContextTrigger}
                    tooltip={{ formatter: (value) => `${value ?? 0}%` }}
                    marks={{ 0: '0%', 50: '50%', 80: '80%', 100: '100%' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="settings-save-row">
            <span><CheckCircleFilled /> {isPersonalSlot ? `当前正在编辑：${activeSlot.name} · ${selectedModel.name}` : `${activeSlot.name}由服务端环境统一管理`}</span>
            <Button type="primary" disabled={!isPersonalSlot} loading={saving} onClick={saveSettings}>{isPersonalSlot ? '保存设置' : '服务端统一配置'}</Button>
          </div>
        </section>

        <section className="settings-search-card page-card">
          <div className="settings-search-heading">
            <span><SearchOutlined /></span>
            <div><strong>搜索引擎</strong><p>选择研究检索服务，并填写该服务对应的 API Key。</p></div>
          </div>
          <div className="settings-search-fields">
            <label>
              <span>搜索服务</span>
              <Select
                value={activeSearchEngineId}
                options={searchEngines.map((engine) => ({ value: engine.id, label: engine.name }))}
                onChange={(value) => {
                  setActiveSearchEngineId(value)
                  setShowSearchApiKey(false)
                }}
              />
            </label>
            {activeSearchEngine.requiresApiKey ? (
              <label className="search-key-field">
                <span>{activeSearchEngine.name} API Key</span>
                <Input
                  disabled
                  prefix={<SafetyCertificateOutlined />}
                  suffix={<button className="settings-key-visibility" type="button" aria-label={showSearchApiKey ? '隐藏搜索 API Key' : '显示搜索 API Key'} onClick={() => setShowSearchApiKey((current) => !current)}>{showSearchApiKey ? <EyeOutlined /> : <EyeInvisibleOutlined />}</button>}
                  type={showSearchApiKey ? 'text' : 'password'}
                  value={activeSearchEngine.apiKey}
                  onChange={(event) => updateSearchApiKey(event.target.value)}
                  placeholder={capabilities?.web_search ? '服务端已配置' : '请在服务端 .env 中配置'}
                />
              </label>
            ) : (
              <div className="search-local-status">
                <span>连接方式</span>
                <strong><CheckCircleFilled /> 本地 Python · 无需 API Key</strong>
              </div>
            )}
            <small>{activeSearchEngine.description} · {activeSearchEngine.requiresApiKey ? '由服务端环境统一配置' : '本地能力'}</small>
          </div>
        </section>

      </div>

      <Modal
        title={`为${activeSlot.name}添加模型`}
        open={addModalOpen}
        okText="创建配置"
        cancelText="取消"
        okButtonProps={{ disabled: !newModelName.trim() }}
        onOk={addModel}
        onCancel={() => {
          setAddModalOpen(false)
          setNewModelName('')
        }}
        closeIcon={<CloseOutlined />}
      >
        <div className="settings-add-modal-field">
          <span>配置名称</span>
          <Input value={newModelName} onChange={(event) => setNewModelName(event.target.value)} onPressEnter={addModel} placeholder="例如：自建模型服务" autoFocus />
          <small>新配置只会加入当前的“{activeSlot.name}”槽位。</small>
        </div>
      </Modal>

      <Modal className="data-source-modal" title="数据源管理" open={dataSourceModalOpen} width={900} footer={null} onCancel={() => setDataSourceModalOpen(false)} closeIcon={<CloseOutlined />}>
        <div className="data-source-manager">
          <aside className="data-source-list">
            <header><div><strong>金融与研究数据源</strong><small>选择预设或创建自己的连接</small></div><Button className="data-source-create-button" type="primary" icon={<PlusOutlined />} onClick={addCustomDataSource}>新建数据源</Button></header>
            <div>{dataSources.length > 0
              ? dataSources.map((source) => <button type="button" className={source.id === activeDataSource?.id ? 'active' : ''} key={source.id} onClick={() => setActiveDataSourceId(source.id)}><span>{source.mode === 'http' ? <ApiOutlined /> : <CodeOutlined />}</span><div><strong>{source.name}</strong><small>{source.description}</small></div><i className={source.enabled ? 'enabled' : ''} /></button>)
              : <div className="data-source-list-empty"><AppstoreOutlined /><strong>还没有数据源</strong><span>点击上方按钮新建连接</span></div>}
            </div>
          </aside>
          {activeDataSource && <section className="data-source-editor">
            <header><div><span>{activeDataSource.mode === 'http' ? <ApiOutlined /> : <CodeOutlined />}</span><div><strong>{activeDataSource.name}</strong><small>{activeDataSource.category}</small></div></div><div className="data-source-editor-actions"><Button className="data-source-delete-button" danger icon={<DeleteOutlined />} onClick={removeActiveDataSource}>删除数据源</Button><label><span>{activeDataSource.enabled ? '已启用' : '未启用'}</span><Switch checked={activeDataSource.enabled} onChange={(enabled) => updateActiveDataSource({ enabled })} /></label></div></header>
            <div className="data-source-fields">
              <label><span>数据源名称</span><Input value={activeDataSource.name} onChange={(event) => updateActiveDataSource({ name: event.target.value })} /></label>
              <label><span>用途说明</span><Input value={activeDataSource.description} onChange={(event) => updateActiveDataSource({ description: event.target.value })} /></label>
              <div className="data-source-mode-field"><span>连接方式</span><Segmented block value={activeDataSource.mode} options={[{ label: 'HTTP 接口规范', value: 'http', icon: <ApiOutlined /> }, { label: 'Python SDK', value: 'python', icon: <CodeOutlined /> }]} onChange={(mode) => updateActiveDataSource({ mode: mode as DataSourceMode })} /></div>
              <label className="data-source-spec-field"><span>{activeDataSource.mode === 'http' ? 'HTTP 接口规范' : 'Python SDK 调用代码'}</span><Input.TextArea value={activeDataSource.specification} onChange={(event) => updateActiveDataSource({ specification: event.target.value })} placeholder={activeDataSource.mode === 'http' ? '填写请求方法、URL、鉴权头、参数与响应数据路径…' : '填写 import、客户端初始化及查询调用示例…'} autoSize={{ minRows: 10, maxRows: 16 }} spellCheck={false} /></label>
            </div>
            <footer><span><SafetyCertificateOutlined /> 配置保存在本机，不会在浏览器中执行代码；需由服务端连接器审核后接入研究流程。</span><Button type="primary" onClick={() => message.success('数据源配置已保存到当前浏览器')}>保存配置</Button></footer>
          </section>}
          {!activeDataSource && <section className="data-source-editor-empty"><AppstoreOutlined /><strong>新建一个数据源开始配置</strong><span>可以填写 HTTP 接口规范或 Python SDK 调用代码。</span><Button type="primary" icon={<PlusOutlined />} onClick={addCustomDataSource}>新建数据源</Button></section>}
        </div>
      </Modal>

      <Modal
        className="data-source-delete-modal"
        title="删除这个数据源？"
        open={Boolean(deleteDataSourceTarget)}
        zIndex={1200}
        centered
        okText="确认删除"
        cancelText="保留"
        okButtonProps={{ danger: true }}
        onOk={confirmRemoveDataSource}
        onCancel={() => setDeleteDataSourceTarget(null)}
        closeIcon={<CloseOutlined />}
      >
        <p>“{deleteDataSourceTarget?.name}”的接口规范、启用状态和本地配置都会被删除，刷新页面也不会恢复。</p>
      </Modal>
    </div>
  )
}
