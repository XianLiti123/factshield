import { useMemo, useState } from 'react'
import {
  ApiOutlined,
  CheckCircleFilled,
  CloseOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'
import { Button, Input, Modal, Select, Switch, Tag, message } from 'antd'

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

export function SettingsView() {
  const [slots, setSlots] = useState<ModelSlot[]>(initialSlots)
  const [activeSlotId, setActiveSlotId] = useState<ModelSlotId>('primary')
  const [deepThinking, setDeepThinking] = useState(true)
  const [showModelApiKey, setShowModelApiKey] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>(initialSearchEngines)
  const [activeSearchEngineId, setActiveSearchEngineId] = useState(initialSearchEngines[0].id)
  const [showSearchApiKey, setShowSearchApiKey] = useState(false)

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

  const saveSettings = () => {
    if (!selectedModel.baseUrl.trim() || !selectedModel.modelName.trim()) {
      message.warning(`请补全${activeSlot.name}的 Base URL 和模型名称`)
      return
    }
    message.success('系统设置已保存（UI 演示）')
  }

  return (
    <div className="settings-page">
      <section className="settings-model-panel page-card">
        <div className="settings-panel-heading">
          <div><span>独立模型分配</span><strong>模型用途</strong></div>
          <Tag>4 个槽位</Tag>
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
          <span>四类模型配置彼此独立；切换或修改当前槽位不会覆盖其他槽位。</span>
        </div>
      </section>

      <div className="settings-content-column">
        <section className="settings-form-card page-card">
          <div className="settings-form-header">
            <div className="settings-selected-model">
              <span>{activeSlot.mark}</span>
              <div><strong>{activeSlot.name}</strong><small>{activeSlot.description}</small></div>
            </div>
            <Tag icon={<CheckCircleFilled />}>独立配置</Tag>
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
            <Button icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>添加候选模型</Button>
            <Button danger type="text" icon={<DeleteOutlined />} onClick={removeSelectedModel}>删除当前</Button>
          </div>

          <div className="settings-form-grid compact">
            <label className="settings-field">
              <span className="settings-field-label">配置名称</span>
              <Input value={selectedModel.name} onChange={(event) => updateSelectedModel('name', event.target.value)} placeholder="例如：DeepSeek Chat" />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">模型名称</span>
              <Input value={selectedModel.modelName} onChange={(event) => updateSelectedModel('modelName', event.target.value)} placeholder="例如：deepseek-chat" />
            </label>
            <label className="settings-field full">
              <span className="settings-field-label">Base URL</span>
              <Input prefix={<ApiOutlined />} value={selectedModel.baseUrl} onChange={(event) => updateSelectedModel('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" />
            </label>
            <label className="settings-field full">
              <span className="settings-field-label">API Key</span>
              <Input
                prefix={<SafetyCertificateOutlined />}
                suffix={<button className="settings-key-visibility" type="button" aria-label={showModelApiKey ? '隐藏模型 API Key' : '显示模型 API Key'} onClick={() => setShowModelApiKey((current) => !current)}>{showModelApiKey ? <EyeOutlined /> : <EyeInvisibleOutlined />}</button>}
                type={showModelApiKey ? 'text' : 'password'}
                value={selectedModel.apiKey}
                onChange={(event) => updateSelectedModel('apiKey', event.target.value)}
                placeholder={`输入${activeSlot.name}的 API Key`}
              />
            </label>
          </div>

          <div className="settings-save-row">
            <span><CheckCircleFilled /> 当前正在编辑：{activeSlot.name} · {selectedModel.name}</span>
            <Button type="primary" onClick={saveSettings}>保存设置</Button>
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
                  placeholder={`输入 ${activeSearchEngine.name} API Key`}
                />
              </label>
            ) : (
              <div className="search-local-status">
                <span>连接方式</span>
                <strong><CheckCircleFilled /> 本地 Python · 无需 API Key</strong>
              </div>
            )}
            <small>{activeSearchEngine.description}</small>
          </div>
        </section>

        <section className="settings-preference-card page-card">
          <div className="settings-preference-copy">
            <span><ThunderboltFilled /></span>
            <div><strong>深度思考</strong><p>仅作用于支持推理模式的主 LLM；不会改变视觉、Embedding 或 Reranker 配置。</p></div>
          </div>
          <Switch checked={deepThinking} onChange={setDeepThinking} />
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
    </div>
  )
}
