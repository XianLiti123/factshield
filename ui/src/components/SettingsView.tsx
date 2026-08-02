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
import {
  getCapabilities,
  compactSession,
  getDataSources,
  getFlowError,
  getSettings,
  listFlowErrors,
  listSessions,
  markFlowErrorRepaired,
  repairFlowError,
  saveDataSources,
  saveModelConfig,
  saveSearchEngine,
  type CapabilityStatus,
  type DataSourceConfig,
  type DataSourceMode,
  type SettingsResponse,
  type SessionCompactResult,
} from '../services/api'
import { useWorkspaceStore } from '../store'

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

type SearchEngineId = 'tavily' | 'python'

type SearchEngine = {
  id: SearchEngineId
  name: string
  description: string
  apiKey: string
  requiresApiKey: boolean
}

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

const builtInDataSourceIds = new Set(['efinance', 'tickflow'])

function createBuiltInDataSources(capabilities: SettingsResponse['global_capabilities'] | null): DataSourceConfig[] {
  return [
    {
      id: 'efinance',
      name: 'efinance',
      description: 'A 股行情与基础金融数据 SDK',
      category: '服务端内置能力',
      mode: 'python',
      specification: "import efinance as ef\n\n# 服务端内置调用示例\ndf = ef.stock.get_quote_history('000001')",
      enabled: Boolean(capabilities?.efinance),
    },
    {
      id: 'tickflow',
      name: 'TickFlow',
      description: '行情、K 线与逐笔数据服务',
      category: '服务端内置能力',
      mode: 'python',
      specification: '# TickFlow 由服务端连接器调用\n# 鉴权与返回结构由服务端统一管理',
      enabled: Boolean(capabilities?.tickflow),
    },
  ]
}

const DEFAULT_CONTEXT_TRIGGER = 80

export function SettingsView() {
  const [slots, setSlots] = useState<ModelSlot[]>(initialSlots)
  const [activeSlotId, setActiveSlotId] = useState<ModelSlotId>('primary')
  const [deepThinking, setDeepThinking] = useState(true)
  const [showModelApiKey, setShowModelApiKey] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>(initialSearchEngines)
  const [activeSearchEngineId, setActiveSearchEngineId] = useState<SearchEngineId>(initialSearchEngines[0].id)
  const [showSearchApiKey, setShowSearchApiKey] = useState(false)
  const [searchSaving, setSearchSaving] = useState(false)
  const [searchStatus, setSearchStatus] = useState<SettingsResponse['search'] | null>(null)
  const [saving, setSaving] = useState(false)
  const [capabilities, setCapabilities] = useState<CapabilityStatus | null>(null)
  const [settingsCapabilities, setSettingsCapabilities] = useState<SettingsResponse['global_capabilities'] | null>(null)
  const [dataSources, setDataSources] = useState<DataSourceConfig[]>([])
  const [dataSourcesLoading, setDataSourcesLoading] = useState(true)
  const [dataSourcesSaving, setDataSourcesSaving] = useState(false)
  const [dataSourceDeleting, setDataSourceDeleting] = useState(false)
  const [dataSourceModalOpen, setDataSourceModalOpen] = useState(false)
  const [activeDataSourceId, setActiveDataSourceId] = useState('efinance')
  const [deleteDataSourceTarget, setDeleteDataSourceTarget] = useState<DataSourceConfig | null>(null)
  const [flowErrors, setFlowErrors] = useState<import('../services/api').FlowError[]>([])
  const [flowErrorsLoading, setFlowErrorsLoading] = useState(false)
  const [flowErrorDetail, setFlowErrorDetail] = useState<import('../services/api').FlowErrorDetail | null>(null)
  const [flowErrorDetailLoading, setFlowErrorDetailLoading] = useState(false)
  const [flowErrorActionId, setFlowErrorActionId] = useState<number | null>(null)
  const [contextSessions, setContextSessions] = useState<string[]>([])
  const [selectedContextSessionId, setSelectedContextSessionId] = useState('')
  const [contextSessionsLoading, setContextSessionsLoading] = useState(true)
  const [contextCompacting, setContextCompacting] = useState(false)
  const [contextCompactResult, setContextCompactResult] = useState<SessionCompactResult | null>(null)
  const workspaceTasks = useWorkspaceStore((state) => state.tasks)

  useEffect(() => {
    getSettings().then((settings) => {
      setSettingsCapabilities(settings.global_capabilities)
      setSearchStatus(settings.search)
      setActiveSearchEngineId(settings.search_engine)
      setSearchEngines((current) => current.map((engine) => engine.id === 'tavily'
        ? { ...engine, apiKey: settings.search.tavily_configured ? '***' : '' }
        : engine))
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
    getDataSources()
      .then(({ data_sources }) => setDataSources(data_sources))
      .catch((error) => message.error(error instanceof Error ? error.message : '数据源加载失败'))
      .finally(() => setDataSourcesLoading(false))
    setFlowErrorsLoading(true)
    listFlowErrors({ status: 'failed' })
      .then(({ errors }) => setFlowErrors(errors))
      .catch(() => setFlowErrors([]))
      .finally(() => setFlowErrorsLoading(false))
    listSessions()
      .then(({ session_ids }) => {
        setContextSessions(session_ids)
        setSelectedContextSessionId((current) => current && session_ids.includes(current) ? current : (session_ids[0] ?? ''))
      })
      .catch(() => setContextSessions([]))
      .finally(() => setContextSessionsLoading(false))
  }, [])

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
  const builtInDataSources = useMemo(() => createBuiltInDataSources(settingsCapabilities), [settingsCapabilities])
  const visibleDataSources = useMemo(() => [
    ...builtInDataSources.map((builtIn) => dataSources.find((source) => source.id === builtIn.id) ?? builtIn),
    ...dataSources.filter((source) => !builtInDataSourceIds.has(source.id)),
  ], [builtInDataSources, dataSources])
  const activeDataSource = visibleDataSources.find((source) => source.id === activeDataSourceId) ?? visibleDataSources[0]
  const activeDataSourceIsBuiltIn = Boolean(activeDataSource
    && builtInDataSourceIds.has(activeDataSource.id)
    && !dataSources.some((source) => source.id === activeDataSource.id))
  const updateActiveDataSource = (patch: Partial<DataSourceConfig>) => {
    if (activeDataSourceIsBuiltIn) return
    setDataSources((current) => current.map((source) => source.id === activeDataSourceId ? { ...source, ...patch } : source))
  }
  const addCustomDataSource = () => {
    if (dataSources.length >= 50) {
      message.warning('最多可配置 50 个自定义数据源')
      return
    }
    const id = `source-${Date.now()}`
    setDataSources((current) => [...current, { id, name: '未命名数据源', description: '填写接口规范后交由服务端连接', category: '自定义', mode: 'http', specification: '', enabled: false }])
    setActiveDataSourceId(id)
  }
  const removeActiveDataSource = () => {
    if (!activeDataSource) return
    setDeleteDataSourceTarget(activeDataSource)
  }
  const confirmRemoveDataSource = async () => {
    if (!deleteDataSourceTarget || dataSourceDeleting) return
    const removedIndex = dataSources.findIndex((source) => source.id === deleteDataSourceTarget.id)
    const remaining = dataSources.filter((source) => source.id !== deleteDataSourceTarget.id)
    setDataSourceDeleting(true)
    try {
      const result = await saveDataSources(remaining)
      setDataSources(result.data_sources)
      setActiveDataSourceId(remaining[Math.min(removedIndex, remaining.length - 1)]?.id ?? 'efinance')
      message.success(`已从服务端删除“${deleteDataSourceTarget.name}”`)
      setDeleteDataSourceTarget(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除数据源失败')
    } finally {
      setDataSourceDeleting(false)
    }
  }

  const saveDataSourceSettings = async () => {
    const missingName = dataSources.find((source) => !source.name.trim())
    if (missingName) {
      setActiveDataSourceId(missingName.id)
      message.warning('请填写数据源名称')
      return
    }
    const missingSpecification = dataSources.find((source) => source.enabled && !source.specification.trim())
    if (missingSpecification) {
      setActiveDataSourceId(missingSpecification.id)
      message.warning(`请先填写“${missingSpecification.name}”的连接规范再启用`)
      return
    }
    setDataSourcesSaving(true)
    try {
      const result = await saveDataSources(dataSources.map((source) => ({
        ...source,
        name: source.name.trim(),
        description: source.description.trim(),
        category: source.category.trim(),
      })))
      setDataSources(result.data_sources)
      message.success('数据源配置已保存，启用的数据源会参与后续研究')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '数据源保存失败')
    } finally {
      setDataSourcesSaving(false)
    }
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

  const saveSearchSettings = async () => {
    setSearchSaving(true)
    try {
      const result = await saveSearchEngine(
        activeSearchEngineId,
        activeSearchEngine.requiresApiKey ? activeSearchEngine.apiKey : undefined,
      )
      setSearchStatus((current) => current ? {
        ...current,
        engine: result.search_engine,
        tavily_configured: result.tavily_configured,
        needs_key: result.needs_key,
        engines: current.engines.map((engine) => engine.id === 'tavily'
          ? { ...engine, configured: result.tavily_configured }
          : engine),
      } : current)
      if (result.tavily_configured) {
        setSearchEngines((current) => current.map((engine) => engine.id === 'tavily'
          ? { ...engine, apiKey: '***' }
          : engine))
      }
      setCapabilities(await getCapabilities())
      if (result.needs_key) message.warning('已切换到 Tavily，但还需要填写可用的 API Key')
      else message.success(`搜索引擎已切换为 ${result.search_engine === 'tavily' ? 'Tavily' : 'Python'}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '搜索设置保存失败')
    } finally {
      setSearchSaving(false)
    }
  }

  const openFlowError = async (errorId: number) => {
    setFlowErrorDetailLoading(true)
    try {
      setFlowErrorDetail(await getFlowError(errorId))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '错误详情读取失败')
    } finally {
      setFlowErrorDetailLoading(false)
    }
  }

  const runFlowErrorAction = async (errorId: number, action: 'repair' | 'mark') => {
    setFlowErrorActionId(errorId)
    try {
      if (action === 'repair') await repairFlowError(errorId)
      else await markFlowErrorRepaired(errorId)
      const result = await listFlowErrors({ status: 'failed' })
      setFlowErrors(result.errors)
      if (flowErrorDetail?.id === errorId && action === 'mark') {
        setFlowErrorDetail({ ...flowErrorDetail, status: 'repaired', repairedAt: new Date().toISOString() })
      }
      message.success(action === 'repair' ? '已发起后端修复' : '已标记为人工修复')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '错误处理失败')
    } finally {
      setFlowErrorActionId(null)
    }
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

  const contextSessionOptions = useMemo(() => contextSessions.map((sessionId) => {
    if (sessionId.startsWith('task-')) {
      const taskId = sessionId.slice(5)
      const task = workspaceTasks.find((item) => item.id === taskId)
      return { value: sessionId, label: task ? `${task.title} · ${taskId}` : `研究任务 · ${taskId}` }
    }
    return { value: sessionId, label: `普通对话 · ${sessionId}` }
  }), [contextSessions, workspaceTasks])

  const compactSelectedContext = async () => {
    if (!selectedContextSessionId || contextCompacting) return
    setContextCompacting(true)
    setContextCompactResult(null)
    try {
      const result = await compactSession(selectedContextSessionId)
      setContextCompactResult(result)
      message.success(`上下文已从 ${result.tokens_before.toLocaleString('zh-CN')} tokens 整理至 ${result.tokens_after.toLocaleString('zh-CN')} tokens`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上下文整理失败')
    } finally {
      setContextCompacting(false)
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
        <span><AppstoreOutlined /></span><div><strong>数据源管理</strong><small>{dataSourcesLoading ? '正在读取服务端配置' : `${visibleDataSources.filter((source) => source.enabled).length} 个已启用 · HTTP / Python SDK`}</small></div><i>管理</i>
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
            <div className="settings-inline-context">
              <div className="settings-inline-context-copy">
                <span><CompressOutlined /></span>
                <div><strong>上下文自动整理</strong><p>接近窗口上限时整理较早内容，保留关键结论和未完成事项。</p></div>
              </div>
              <div className="settings-inline-context-control">
                <div className="settings-context-toggle">
                  <div>
                    <strong>触发比例</strong>
                    <span>服务端当前固定在窗口的 {DEFAULT_CONTEXT_TRIGGER}% 开始整理</span>
                  </div>
                  <Switch size="small" checked disabled />
                </div>
                <div className="settings-context-slider">
                  <div><span>当前阈值</span><strong>{DEFAULT_CONTEXT_TRIGGER}%</strong></div>
                  <Slider
                    min={0}
                    max={100}
                    value={DEFAULT_CONTEXT_TRIGGER}
                    disabled
                    tooltip={{ formatter: (value) => `${value ?? 0}%` }}
                    marks={{ 0: '0%', 50: '50%', 80: '80%', 100: '100%' }}
                  />
                </div>
                <div className="settings-context-manual">
                  <div>
                    <span>立即整理指定会话</span>
                    <Select
                      value={selectedContextSessionId || undefined}
                      loading={contextSessionsLoading}
                      disabled={contextSessionsLoading || contextSessionOptions.length === 0}
                      options={contextSessionOptions}
                      placeholder={contextSessionsLoading ? '正在读取会话' : '暂无可整理的会话'}
                      onChange={(value) => {
                        setSelectedContextSessionId(value)
                        setContextCompactResult(null)
                      }}
                    />
                  </div>
                  <Button
                    icon={<CompressOutlined />}
                    loading={contextCompacting}
                    disabled={!selectedContextSessionId}
                    onClick={() => void compactSelectedContext()}
                  >立即整理</Button>
                </div>
                {contextCompactResult && (
                  <div className="settings-context-result">
                    <CheckCircleFilled />
                    <span>整理完成</span>
                    <strong>{contextCompactResult.tokens_before.toLocaleString('zh-CN')} → {contextCompactResult.tokens_after.toLocaleString('zh-CN')} tokens</strong>
                  </div>
                )}
                <small className="settings-context-server-note">自动触发仍由服务端固定为 {DEFAULT_CONTEXT_TRIGGER}%；“立即整理”已接入会话压缩接口，完整聊天记录不会删除。</small>
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
                  prefix={<SafetyCertificateOutlined />}
                  suffix={<button className="settings-key-visibility" type="button" aria-label={showSearchApiKey ? '隐藏搜索 API Key' : '显示搜索 API Key'} onClick={() => setShowSearchApiKey((current) => !current)}>{showSearchApiKey ? <EyeOutlined /> : <EyeInvisibleOutlined />}</button>}
                  type={showSearchApiKey ? 'text' : 'password'}
                  value={activeSearchEngine.apiKey}
                  onChange={(event) => updateSearchApiKey(event.target.value)}
                  placeholder={searchStatus?.tavily_configured ? '已保存，留空可保留原 Key' : '请输入 Tavily API Key'}
                />
              </label>
            ) : (
              <div className="search-local-status">
                <span>连接方式</span>
                <strong><CheckCircleFilled /> 本地 Python · 无需 API Key</strong>
              </div>
            )}
            <small>{activeSearchEngine.description} · {activeSearchEngine.requiresApiKey
              ? searchStatus?.tavily_configured ? '账号已配置 Key' : '尚未配置 Key'
              : '免 Key，本机直接检索'}</small>
            <div className="settings-search-actions">
              <span>{searchStatus?.engine === activeSearchEngineId ? '当前后端正在使用此引擎' : '选择尚未保存到后端'}</span>
              <Button type="primary" loading={searchSaving} onClick={saveSearchSettings}>保存搜索设置</Button>
            </div>
          </div>
        </section>

        <section className="settings-errors-card page-card">
          <div className="settings-errors-heading">
            <div><strong>服务错误记录</strong><p>查看后端记录的失败流程，并从这里发起修复。</p></div>
            <Button size="small" onClick={() => {
              setFlowErrorsLoading(true)
              listFlowErrors({ status: 'failed' }).then(({ errors }) => setFlowErrors(errors)).catch(() => message.error('错误记录读取失败')).finally(() => setFlowErrorsLoading(false))
            }}>刷新</Button>
          </div>
          {flowErrorsLoading ? <div className="settings-errors-empty">正在读取错误记录…</div> : flowErrors.length === 0 ? <div className="settings-errors-empty"><CheckCircleFilled /> 当前没有待处理的服务错误</div> : (
            <div className="settings-error-list">
              {flowErrors.slice(0, 8).map((item) => <div className="settings-error-item" key={item.id}>
                <div className="settings-error-copy"><strong>{item.node || item.flowType}</strong><span>{item.error}</span><small>{item.flowType} · {item.flowId} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small></div>
                <div className="settings-error-actions"><Button size="small" onClick={() => void openFlowError(item.id)}>详情</Button><Button size="small" type="primary" loading={flowErrorActionId === item.id} onClick={() => void runFlowErrorAction(item.id, 'repair')}>修复</Button></div>
              </div>)}
            </div>
          )}
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

      <Modal title="服务错误详情" open={Boolean(flowErrorDetail) || flowErrorDetailLoading} footer={null} onCancel={() => setFlowErrorDetail(null)}>
        {flowErrorDetailLoading ? <div className="settings-errors-empty">正在读取详情…</div> : flowErrorDetail && <div className="settings-error-detail">
          <div><span>流程</span><strong>{flowErrorDetail.flowType} · {flowErrorDetail.flowId}</strong></div>
          <div><span>节点</span><strong>{flowErrorDetail.node}</strong></div>
          <div><span>错误</span><p>{flowErrorDetail.error}</p></div>
          <div><span>触发输入</span><pre>{flowErrorDetail.prompt || '未返回'}</pre></div>
          <div><span>堆栈</span><pre>{flowErrorDetail.traceback || '未返回'}</pre></div>
          <Button type="primary" loading={flowErrorActionId === flowErrorDetail.id} onClick={() => void runFlowErrorAction(flowErrorDetail.id, 'mark')}>标记为已修复</Button>
        </div>}
      </Modal>

      <Modal className="data-source-modal" title="数据源管理" open={dataSourceModalOpen} width={900} footer={null} onCancel={() => setDataSourceModalOpen(false)} closeIcon={<CloseOutlined />}>
        <div className="data-source-manager">
          <aside className="data-source-list">
            <header><div><strong>金融与研究数据源</strong><small>内置能力与账号自定义连接</small></div><Button className="data-source-create-button" type="primary" icon={<PlusOutlined />} disabled={dataSourcesLoading} onClick={addCustomDataSource}>新建数据源</Button></header>
            <div>{dataSourcesLoading
              ? <div className="data-source-list-empty"><AppstoreOutlined /><strong>正在读取数据源</strong><span>从服务端同步当前账号配置</span></div>
              : visibleDataSources.length > 0
              ? visibleDataSources.map((source) => <button type="button" className={source.id === activeDataSource?.id ? 'active' : ''} key={source.id} onClick={() => setActiveDataSourceId(source.id)}><span>{source.mode === 'http' ? <ApiOutlined /> : <CodeOutlined />}</span><div><strong>{source.name}</strong><small>{source.description}</small></div><i className={source.enabled ? 'enabled' : ''} /></button>)
              : <div className="data-source-list-empty"><AppstoreOutlined /><strong>还没有数据源</strong><span>点击上方按钮新建连接</span></div>}
            </div>
          </aside>
          {activeDataSource && <section className="data-source-editor">
            <header><div><span>{activeDataSource.mode === 'http' ? <ApiOutlined /> : <CodeOutlined />}</span><div><strong>{activeDataSource.name}</strong><small>{activeDataSource.category}</small></div></div><div className="data-source-editor-actions">{!activeDataSourceIsBuiltIn && <Button className="data-source-delete-button" danger icon={<DeleteOutlined />} onClick={removeActiveDataSource}>删除数据源</Button>}<label><span>{activeDataSource.enabled ? (activeDataSourceIsBuiltIn ? '服务已就绪' : '已启用') : (activeDataSourceIsBuiltIn ? '服务未就绪' : '未启用')}</span><Switch disabled={activeDataSourceIsBuiltIn} checked={activeDataSource.enabled} onChange={(enabled) => updateActiveDataSource({ enabled })} /></label></div></header>
            <div className="data-source-fields">
              <label><span>数据源名称</span><Input disabled={activeDataSourceIsBuiltIn} value={activeDataSource.name} onChange={(event) => updateActiveDataSource({ name: event.target.value })} /></label>
              <label><span>用途说明</span><Input disabled={activeDataSourceIsBuiltIn} value={activeDataSource.description} onChange={(event) => updateActiveDataSource({ description: event.target.value })} /></label>
              <div className="data-source-mode-field"><span>连接方式</span><Segmented disabled={activeDataSourceIsBuiltIn} block value={activeDataSource.mode} options={[{ label: 'HTTP 接口规范', value: 'http', icon: <ApiOutlined /> }, { label: 'Python SDK', value: 'python', icon: <CodeOutlined /> }]} onChange={(mode) => updateActiveDataSource({ mode: mode as DataSourceMode })} /></div>
              <label className="data-source-spec-field"><span>{activeDataSource.mode === 'http' ? 'HTTP 接口规范' : 'Python SDK 调用代码'}</span><Input.TextArea disabled={activeDataSourceIsBuiltIn} value={activeDataSource.specification} onChange={(event) => updateActiveDataSource({ specification: event.target.value })} placeholder={activeDataSource.mode === 'http' ? '填写请求方法、URL、鉴权头、参数与响应数据路径…' : '填写 import、客户端初始化及查询调用示例…'} autoSize={{ minRows: 10, maxRows: 16 }} spellCheck={false} /></label>
            </div>
            <footer>{activeDataSourceIsBuiltIn
              ? <><span><SafetyCertificateOutlined /> 这是服务端内置金融能力，状态由依赖与服务端密钥配置决定。</span><Button disabled>{activeDataSource.enabled ? '当前可用' : '等待服务端配置'}</Button></>
              : <><span><SafetyCertificateOutlined /> 配置会加密保存到当前账号；启用后可供后续研究任务调用。</span><Button type="primary" loading={dataSourcesSaving} disabled={dataSourcesLoading} onClick={saveDataSourceSettings}>保存配置</Button></>}
            </footer>
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
        confirmLoading={dataSourceDeleting}
        onOk={confirmRemoveDataSource}
        onCancel={() => setDeleteDataSourceTarget(null)}
        closeIcon={<CloseOutlined />}
      >
        <p>“{deleteDataSourceTarget?.name}”的接口规范和启用状态会从当前账号中删除，刷新页面也不会恢复。</p>
      </Modal>
    </div>
  )
}
