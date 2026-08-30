import { BulbOutlined, CheckOutlined, SendOutlined } from '@ant-design/icons'
import { Button, Input, message } from 'antd'
import { useEffect, useState } from 'react'
import type { AgentQuestion } from '../types'

type AgentQuestionCardProps = {
  question: AgentQuestion
  context: 'research' | 'assistant'
  answer?: string
  onAnswer: (answer: string) => Promise<void>
}

export function AgentQuestionCard({ question, context, answer, onAnswer }: AgentQuestionCardProps) {
  const options = question.options ?? []
  const resolvedAnswer = answer || question.answer?.trim() || ''
  const [selectedOption, setSelectedOption] = useState('')
  const [customMode, setCustomMode] = useState(options.length === 0)
  const [customAnswer, setCustomAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setSelectedOption('')
    setCustomMode(options.length === 0)
    setCustomAnswer('')
  }, [question.id, options.length])

  const submit = async () => {
    const finalAnswer = (customMode ? customAnswer : selectedOption).trim()
    if (!finalAnswer) {
      message.warning(options.length > 0 ? '请选择一个答案，或写下你的具体说明' : '请先写下你的回答')
      return
    }
    setSubmitting(true)
    try {
      await onAnswer(finalAnswer)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={`agent-question-card ${context}${resolvedAnswer ? ' answered' : ''}`}>
      <div className="agent-question-heading">
        <span className="agent-question-icon"><BulbOutlined /></span>
        <div>
          <span className="agent-question-kicker">{resolvedAnswer ? '信息已补充' : '等待你的回答'}</span>
          <strong>{question.question}</strong>
          {!resolvedAnswer && <p>补充这一点后，小盾会带着你的答案继续，不会重新开始。</p>}
        </div>
      </div>

      {resolvedAnswer ? (
        <div className="agent-question-answered">
          <CheckOutlined />
          <div><span>你的回答</span><strong>{resolvedAnswer}</strong><small>小盾正在按这条信息继续处理</small></div>
        </div>
      ) : (
        <>
          {options.length > 0 && (
            <div className="agent-question-options">
              {options.map((option) => (
                <button
                  type="button"
                  className={!customMode && selectedOption === option ? 'selected' : ''}
                  key={option}
                  onClick={() => { setSelectedOption(option); setCustomMode(false) }}
                >
                  <i>{!customMode && selectedOption === option ? <CheckOutlined /> : null}</i>
                  <span>{option}</span>
                </button>
              ))}
              {question.allowCustom && (
                <button
                  type="button"
                  className={customMode ? 'selected custom' : 'custom'}
                  onClick={() => { setSelectedOption(''); setCustomMode(true) }}
                >
                  <i>{customMode ? <CheckOutlined /> : null}</i>
                  <span>其他，我想具体说明</span>
                </button>
              )}
            </div>
          )}

          {(options.length === 0 || customMode) && (
            <Input.TextArea
              value={customAnswer}
              onChange={(event) => setCustomAnswer(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
              autoFocus={customMode && options.length > 0}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="写下具体对象、时间范围、关注指标或其他要求…"
            />
          )}

          <div className="agent-question-actions">
            <span>Enter 提交 · Shift + Enter 换行</span>
            <Button type="primary" icon={<SendOutlined />} loading={submitting} onClick={() => void submit()}>
              回答并继续
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
