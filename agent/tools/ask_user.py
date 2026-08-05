"""ask_user 提问工具：研究流水线闭包版 + 对话小盾通用版。

调用后：写 pending 问题 -> 发布提问事件 -> 阻塞等待用户回答 -> 答案写入
agent_questions 并以工具结果返回（成为 ToolMessage 进入 LLM 上下文）。
"""

from langchain_core.tools import tool

from .. import questions
from ..session import events as session_events
from ..session import store as session_store

@tool
def ask_user(question: str, options: list[str] | None = None,
             allow_custom: bool = True) -> str:
    """向用户提问以澄清任务。

当用户的研究/分析任务过于宽泛（如“随便研究点东西”）、缺少关键信息（公司、年份、
指标口径、信源偏好等）、或你对用户意图理解不确定时，调用本工具向用户提问。
options 可提供候选答案（最多 6 个）；留空则为纯输入框；allow_custom=True 时用户
除选项外还可自由输入。调用后你会等待用户回答，回答会作为本工具的结果返回。
不要臆测缺失信息，已回答过的问题不要重复提问。"""
    return _ask_in_session(question, options, allow_custom)


def _ask_in_session(question: str, options: list[str] | None,
                    allow_custom: bool) -> str:
    session_id = session_store.current_session_id.get()
    user_id = session_store.current_user_id.get()
    if not session_id or not session_events.has_subscribers(session_id):
        return ("当前环境不支持向用户提问（未连接到对话会话），"
                "请基于已有信息继续，不要臆测缺失信息。")
    q = questions.create_question(
        scope="session", user_id=user_id, question=question,
        options=options, allow_custom=allow_custom,
        session_id=session_id, actor="agent", node="chat",
    )
    session_events.publish(session_id, {
        "kind": "question",
        "type": "question",
        "content": q["question"],
        "payload": {
            "question_id": q["id"],
            "question": q["question"],
            "options": q["options"],
            "allow_custom": q["allow_custom"],
            "actor": q["actor"],
        },
    })
    try:
        return questions.wait_for_answer(q["id"])
    except questions.QuestionCancelled as e:
        return f"用户已取消本次提问（{e.reason}），请基于已有信息继续。"


def make_task_ask_tool(task_id: str, user_id: int, actor: str, node: str,
                       stop_event=None):
    """研究流水线版：绑定任务与子智能体，事件走任务事件通道并写工具轨迹。"""

    @tool
    def ask_user(question: str, options: list[str] | None = None,
                 allow_custom: bool = True) -> str:
        """向用户提问以澄清任务。

当研究/分析任务过于宽泛（如“随便研究点东西”）、缺少关键信息（公司、年份、指标
口径、信源偏好等）、或你对任务理解不确定时，调用本工具向用户提问。options 可提供
候选答案（最多 6 个）；留空则为纯输入框；allow_custom=True 时用户除选项外还可
自由输入。调用后你会等待用户回答，回答会作为本工具的结果返回。不要臆测缺失信息，
已回答过的问题不要重复提问。"""
        from ..research import runner, store  #延迟导入，避免循环依赖
        q = questions.create_question(
            scope="task", user_id=user_id, question=question,
            options=options, allow_custom=allow_custom,
            task_id=task_id, actor=actor, node=node,
        )
        runner.publish_event(task_id, actor, "question", {
            "title": "需要你补充信息",
            "speech": q["question"],
            "question_id": q["id"],
            "question": q["question"],
            "options": q["options"],
            "allow_custom": q["allow_custom"],
            "details": [],
            "metrics": [],
            "progress": None,
        })
        answer = questions.wait_for_answer(q["id"], stop_event=stop_event)
        store.append_tool_trace(
            task_id, actor, node, "ask_user",
            {"question": q["question"], "options": q["options"],
             "allow_custom": q["allow_custom"]},
            answer,
        )
        return answer
    return ask_user
