"""技能注册表：扫描 agent/skills/ 下各技能目录，解析 SKILL.md frontmatter，
并通过 mtime 快照实现热重载（修改技能文件后无需重启服务）。"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).resolve().parent
_DEFAULT_TIMEOUT_SECONDS = 60
_DEFAULT_VERSION = "1.0.0"


@dataclass(frozen=True)
class Skill:
    """一个已加载的技能：id 为目录名，name/description 供 Agent 自主判断使用时机。"""

    id: str
    name: str
    description: str
    version: str
    path: Path
    instructions: str
    timeout: int = _DEFAULT_TIMEOUT_SECONDS

    @property
    def kind(self) -> str:
        return "executable" if (self.path / "run.py").is_file() else "instruction"


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """解析 SKILL.md 开头 `---` 包裹的简化 YAML frontmatter（key: value 行）。"""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    meta: dict[str, str] = {}
    for line in text[3:end].strip().splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip().lower()] = value.strip()
    return meta, text[end + 4:].lstrip("\n")


def _load_skill(skill_dir: Path) -> Skill | None:
    md_path = skill_dir / "SKILL.md"
    if not md_path.is_file():
        return None
    raw = md_path.read_text(encoding="utf-8", errors="replace")
    meta, instructions = _parse_frontmatter(raw)
    instructions = instructions.strip()

    if meta.get("enabled", "true").strip().lower() in ("false", "no", "0"):
        logger.info("技能 %s 已禁用，跳过", skill_dir.name)
        return None

    name = (meta.get("name") or skill_dir.name).strip()
    description = (meta.get("description") or "").strip()
    if not description and instructions:
        description = instructions.splitlines()[0].strip()
    if not description:
        logger.warning("技能 %s 缺少 description，已跳过", skill_dir.name)
        return None

    try:
        timeout = int(meta.get("timeout", _DEFAULT_TIMEOUT_SECONDS))
    except ValueError:
        timeout = _DEFAULT_TIMEOUT_SECONDS

    return Skill(
        id=skill_dir.name,
        name=name,
        description=description,
        version=meta.get("version", _DEFAULT_VERSION).strip(),
        path=skill_dir,
        instructions=instructions,
        timeout=timeout,
    )


def _snapshot() -> tuple[tuple[str, int, int], ...]:
    """返回 (目录名, SKILL.md mtime_ns, run.py mtime_ns) 快照，用于热重载判断。"""
    snap: list[tuple[str, int, int]] = []
    for child in sorted(SKILLS_DIR.iterdir()):
        if not child.is_dir() or child.name.startswith((".", "__")):
            continue
        md = child / "SKILL.md"
        if not md.is_file():
            continue
        run_py = child / "run.py"
        snap.append((
            child.name,
            md.stat().st_mtime_ns,
            run_py.stat().st_mtime_ns if run_py.is_file() else 0,
        ))
    return tuple(snap)


def _scan() -> dict[str, Skill]:
    skills: dict[str, Skill] = {}
    for child in sorted(SKILLS_DIR.iterdir()):
        if not child.is_dir() or child.name.startswith((".", "__")):
            continue
        skill = _load_skill(child)
        if skill:
            skills[skill.id] = skill
    return skills


_cache: dict[str, Skill] = {}
_cache_key: tuple[tuple[str, int, int], ...] | None = None


def reload_skills() -> dict[str, Skill]:
    """强制重新扫描并返回全部技能。"""
    global _cache, _cache_key
    _cache = _scan()
    _cache_key = _snapshot()
    return _cache


def list_skills() -> list[Skill]:
    """返回当前全部技能；目录或文件变化时自动重扫。"""
    global _cache, _cache_key
    current = _snapshot()
    if _cache_key != current:
        _cache = _scan()
        _cache_key = current
    return list(_cache.values())


def get_skill(name_or_id: str) -> Skill | None:
    """按技能 id（目录名）或 name（frontmatter 名称）查找，忽略大小写。"""
    key = name_or_id.strip().lower()
    for skill in list_skills():
        if skill.id.lower() == key or skill.name.lower() == key:
            return skill
    return None


def skill_catalog() -> str:
    """生成注入系统提示词的可用技能清单（只含名称与描述，不占上下文）。"""
    skills = list_skills()
    if not skills:
        return ""
    return "\n".join(f"- {s.name}：{s.description}" for s in skills)
