import io
import re

#研究底稿导出：把 _build_report 产出的 Markdown 渲染为 Word / PDF 字节流
#只需覆盖底稿用到的语法：#/##/### 标题、- 列表（含两格缩进子项）、**粗体**、> 引用、| 表格 |、--- 分隔线


def _strip_md(text: str) -> str:
    #去掉行内标记（粗体/斜体/行内代码），导出为纯文本样式
    return re.sub(r"\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*", lambda m: m.group(1) or m.group(2) or m.group(3), text)


def _parse(md: str) -> list[tuple[str, object]]:
    #把 Markdown 解析为块序列：("h1"/"h2"/"h3", 文本)、("bullet", (缩进级, 文本))、
    #("quote", 文本)、("table", [[单元格...], ...])、("para", 文本)、("hr", None)
    blocks: list[tuple[str, object]] = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("|"):
            table = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(set(c) <= set("-: ") for c in cells):  #跳过分隔行
                    table.append([_strip_md(c) for c in cells])
                i += 1
            if table:
                blocks.append(("table", table))
            continue
        if stripped.startswith("### "):
            blocks.append(("h3", _strip_md(stripped[4:])))
        elif stripped.startswith("## "):
            blocks.append(("h2", _strip_md(stripped[3:])))
        elif stripped.startswith("# "):
            blocks.append(("h1", _strip_md(stripped[2:])))
        elif stripped.startswith("> "):
            blocks.append(("quote", _strip_md(stripped[2:])))
        elif stripped in ("---", "***"):
            blocks.append(("hr", None))
        elif stripped.startswith("- "):
            indent = (len(line) - len(line.lstrip())) // 2
            blocks.append(("bullet", (indent, _strip_md(stripped[2:]))))
        else:
            blocks.append(("para", _strip_md(stripped)))
        i += 1
    return blocks


def _display_width(text: str) -> int:
    #估算文本显示宽度：CJK 字符计 2，其余计 1（用于表格列宽分配）
    return sum(2 if ord(ch) > 0x2E7F else 1 for ch in text)


def _col_widths(rows: list[list[str]], avail: float) -> list[float]:
    #按各列内容宽度占比分配表格列宽：长文本列自动换行，短列（时段/数字）不被挤压
    cols = max(len(r) for r in rows)
    weights = []
    for c in range(cols):
        w = max((_display_width(r[c]) for r in rows if c < len(r)), default=1)
        weights.append(min(w, 40))  #封顶，避免个别超长单元格独占宽度
    total = sum(weights) or 1
    widths = [max(avail * 0.08, avail * w / total) for w in weights]  #每列保底 8%
    scale = avail / sum(widths)  #保底后总和可能超出可用宽度，等比缩回
    return [w * scale for w in widths]


def report_to_docx(md: str) -> bytes:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.shared import Pt

    doc = Document()
    #正文中文字体：微软雅黑（同时设 ascii 与 eastAsia 才生效）
    style = doc.styles["Normal"]
    style.font.name = "Microsoft YaHei"
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")  # type: ignore[union-attr]

    for kind, content in _parse(md):
        if kind in ("h1", "h2", "h3"):
            doc.add_heading(str(content), level=int(kind[1]))
        elif kind == "bullet":
            indent, text = content  # type: ignore[misc]
            doc.add_paragraph(text, style="List Bullet" if indent == 0 else "List Bullet 2")
        elif kind == "quote":
            doc.add_paragraph(str(content)).paragraph_format.left_indent = Pt(18)
        elif kind == "table":
            rows = content  # type: ignore[assignment]
            table = doc.add_table(rows=len(rows), cols=len(rows[0]))  # type: ignore[arg-type]
            table.style = "Table Grid"
            table.autofit = False  #关闭自动布局，按内容占比固定列宽，防止长文本列挤压短列
            from docx.shared import Cm
            widths = _col_widths(rows, 15.9)  #A4 默认页边距下正文可用宽度约 15.9cm
            for c, w in enumerate(widths):
                table.columns[c].width = Cm(w)  #写 tblGrid（Word 布局以此为准）
            for r, row in enumerate(rows):  # type: ignore[union-attr]
                for c, cell in enumerate(row):
                    table.cell(r, c).text = cell
                    table.cell(r, c).width = Cm(widths[c])  #单元格级 tcW 同步设置
        elif kind == "para":
            doc.add_paragraph(str(content))
        #hr 在 Word 中忽略
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def report_to_pdf(md: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (HRFlowable, Paragraph, SimpleDocTemplate,
                                    Spacer, Table, TableStyle)

    font = "FSCJK"
    try:
        pdfmetrics.registerFont(TTFont(font, r"C:\Windows\Fonts\msyh.ttc", subfontIndex=0))
    except Exception:
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        font = "STSong-Light"  #系统字体不可用时回退 reportlab 自带 CID 中文字体
        pdfmetrics.registerFont(UnicodeCIDFont(font))

    styles = {
        "h1": ParagraphStyle("h1", fontName=font, fontSize=18, leading=24, spaceAfter=8, wordWrap="CJK"),
        "h2": ParagraphStyle("h2", fontName=font, fontSize=14, leading=20, spaceBefore=10, spaceAfter=6, wordWrap="CJK"),
        "h3": ParagraphStyle("h3", fontName=font, fontSize=12, leading=17, spaceBefore=8, spaceAfter=4, wordWrap="CJK"),
        "body": ParagraphStyle("body", fontName=font, fontSize=10, leading=15, spaceAfter=4, wordWrap="CJK"),
        "quote": ParagraphStyle("quote", fontName=font, fontSize=9, leading=14,
                                leftIndent=14, textColor="#555555", spaceAfter=6, wordWrap="CJK"),
    }

    def esc(text: str) -> str:
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    story: list = []
    for kind, content in _parse(md):
        if kind in ("h1", "h2", "h3"):
            story.append(Paragraph(esc(str(content)), styles[kind]))
        elif kind == "bullet":
            indent, text = content  # type: ignore[misc]
            story.append(Paragraph(("　" * indent) + "• " + esc(text), styles["body"]))
        elif kind == "quote":
            story.append(Paragraph(esc(str(content)), styles["quote"]))
        elif kind == "table":
            rows = [[Paragraph(esc(cell), styles["body"]) for cell in row]
                    for row in content]  # type: ignore[union-attr]
            avail = A4[0] - 40 * mm  #页面可用宽度（左右各 20mm 边距）
            table = Table(rows, colWidths=_col_widths(content, avail))  # type: ignore[arg-type]
            table.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, "#999999"),
                ("BACKGROUND", (0, 0), (-1, 0), "#EEEEEE"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            story += [table, Spacer(1, 4 * mm)]
        elif kind == "para":
            story.append(Paragraph(esc(str(content)), styles["body"]))
        elif kind == "hr":
            story.append(HRFlowable(width="100%", thickness=0.5, color="#999999"))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=18 * mm, bottomMargin=18 * mm).build(story)
    return buf.getvalue()
