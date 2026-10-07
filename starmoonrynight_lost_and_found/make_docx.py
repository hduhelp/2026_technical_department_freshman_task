# -*- coding: utf-8 -*-
"""
失物招领系统 · 设计说明书 DOCX 生成脚本
读取工作目录下的 Markdown 设计文档 + 图/*.png，汇编为一份 Word 文档。

依赖：python-docx（由 load_workspace_dependencies 提供的解释器自带）
用法： python make_docx.py
输出： ./失物招领系统设计说明书.docx
"""
import os
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BASE = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(BASE, "图")
OUT = os.path.join(BASE, "失物招领系统设计说明书.docx")

CN_FONT = "微软雅黑"
EN_FONT = "Segoe UI"
MONO_FONT = "Consolas"

TITLE = "失物招领系统设计说明书"
SUBTITLE = "校园 / 园区极简版 · 仅设计，不含实现代码"

DOCS = [
    ("需求规格说明书", "01-需求规格说明书.md"),
    ("概要设计说明书", "02-概要设计说明书.md"),
    ("数据库设计说明书", "03-数据库设计说明书.md"),
    ("接口设计说明书", "04-接口设计说明书.md"),
    ("详细设计说明书", "05-详细设计说明书.md"),
    ("界面设计说明书", "06-界面设计说明书.md"),
    ("测试与验收设计", "07-测试与验收设计.md"),
    ("界面与功能说明（静态原型）", "08-界面与功能说明.md"),
    ("部署与运维说明", "09-部署与运维说明.md"),
]

# 文档级别：用于把 Markdown 的 # 标题降级为文档内的二级标题
H1, H2, H3, H4 = 1, 2, 3, 4   # Word 标题级别基准


# ----------------------------------------------------------------------
# 基础工具
# ----------------------------------------------------------------------
def set_run_font(run, size=None, bold=None, color=None, mono=False, italic=None):
    name = MONO_FONT if mono else EN_FONT
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), MONO_FONT if mono else CN_FONT)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def add_para(doc, text="", size=10.5, bold=False, align=None, color=None,
             space_before=0, space_after=4, indent=None, line=1.45, mono=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if align:
        p.alignment = align
    if indent:
        pf.left_indent = Cm(indent)
    if text:
        run = p.add_run(text)
        set_run_font(run, size=size, bold=bold, color=color, mono=mono)
    return p


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hexcolor)
    tcPr.append(shd)


def set_repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def add_inline_runs(p, text, size=10.5, mono=False, base_bold=False):
    """处理 **粗体**、`代码` 内联标记，并把 Markdown 链接降级为显示文本"""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    tokens = re.split(r"(\*\*.+?\*\*|`[^`]+`)", text)
    for tk in tokens:
        if not tk:
            continue
        if tk.startswith("**") and tk.endswith("**") and len(tk) > 4:
            r = p.add_run(tk[2:-2])
            set_run_font(r, size=size, bold=True)
        elif tk.startswith("`") and tk.endswith("`") and len(tk) > 2:
            r = p.add_run(tk[1:-1])
            set_run_font(r, size=size - 0.5, mono=True, color="B03030")
        else:
            r = p.add_run(tk)
            set_run_font(r, size=size, bold=base_bold, mono=mono)
    return p


def add_heading(doc, text, level):
    p = doc.add_paragraph(style=f"Heading {min(level, 4)}")
    pf = p.paragraph_format
    pf.space_before = Pt(14 if level <= 2 else 9)
    pf.space_after = Pt(5)
    pf.line_spacing = 1.3
    r = p.add_run(text)
    sizes = {1: 16, 2: 13.5, 3: 12, 4: 11}
    colors = {1: "1E4FD8", 2: "1F2329", 3: "2F6BFF", 4: "5A6270"}
    set_run_font(r, size=sizes.get(level, 11), bold=True, color=colors.get(level, "1F2329"))
    return p


def _twips_cm(cm):
    return int(round(cm * 567))


def _text_w(s, size):
    """估算文本显示宽度（cm）：中文按 1 em，ASCII 按 0.55 em"""
    w = 0.0
    for ch in s:
        w += 1.0 if ord(ch) > 0x2000 else 0.55
    return w * size * 0.03528


def auto_widths(rows, cols, total_cm, size=9.8):
    """按各列内容长度自动分配列宽（保证不溢出内容区）"""
    need = []
    for j in range(cols):
        longest = 1.0
        lines = []
        for r in rows:
            cell = r[j] if j < len(r) else ""
            plain = re.sub(r"\*\*|`", "", cell)
            longest = max(longest, _text_w(plain, size))
            lines.append(_text_w(plain, size))
        avg = sum(lines) / max(len(lines), 1)
        # 期望宽度：内容长度的 0.3 倍（约每行 18 字）与单行最长词之间的较大者
        need.append(max(longest, avg * 0.32, 1.6))
    total_need = sum(need)
    return [total_cm * n / total_need for n in need]


def set_table_fixed(t, total_cm, widths_cm=None):
    """把表格设为固定布局，并按内容区宽度分配列宽（避免自动伸缩溢出页面）"""
    total = _twips_cm(total_cm)
    n = len(t.columns)
    if widths_cm:
        ws = [_twips_cm(w) for w in widths_cm]
        while len(ws) < n:
            ws.append(int(total / n))
        scale = total / sum(ws)
        ws = [max(int(w * scale), 400) for w in ws]
    else:
        ws = [int(total / n)] * n
    tblPr = t._tbl.tblPr
    for el in tblPr.findall(qn("w:tblLayout")):
        tblPr.remove(el)
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(total))
    for grid in t._tbl.findall(qn("w:tblGrid")):
        t._tbl.remove(grid)
    grid = OxmlElement("w:tblGrid")
    for w in ws:
        gc = OxmlElement("w:gridCol")
        gc.set(qn("w:w"), str(w))
        grid.append(gc)
    t._tbl.insert(list(t._tbl).index(tblPr) + 1, grid)
    for row in t.rows:
        for j, cell in enumerate(row.cells):
            if j >= n:
                continue
            tcPr = cell._tc.get_or_add_tcPr()
            for el in tcPr.findall(qn("w:tcW")):
                tcPr.remove(el)
            tcW = OxmlElement("w:tcW")
            tcW.set(qn("w:type"), "dxa")
            tcW.set(qn("w:w"), str(ws[j]))
            tcPr.append(tcW)


def add_table(doc, rows, header=True, widths=None, size=9.8, content_cm=17.6):
    if not rows:
        return
    cols = max(len(r) for r in rows)
    t = doc.add_table(rows=0, cols=cols)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        cells = t.add_row().cells
        for j in range(cols):
            val = row[j] if j < len(row) else ""
            cell = cells[j]
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(1.5)
            p.paragraph_format.space_after = Pt(1.5)
            p.paragraph_format.line_spacing = 1.2
            add_inline_runs(p, val, size=size, base_bold=(header and i == 0))
            if header and i == 0:
                shade(cell, "EAF1FF")
                for r in p.runs:
                    r.font.bold = True
    if header:
        set_repeat_header(t.rows[0])
    set_table_fixed(t, content_cm, widths or auto_widths(rows, cols, content_cm, size))
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def add_code_block(doc, lines):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(4)
    pf.space_after = Pt(8)
    pf.left_indent = Cm(0.4)
    pf.line_spacing = 1.15
    shade_para(p, "F7F8FA")
    for i, ln in enumerate(lines):
        r = p.add_run(ln)
        set_run_font(r, size=9, mono=True, color="333A45")
        if i != len(lines) - 1:
            r.add_break()
    return p


def shade_para(p, hexcolor):
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hexcolor)
    pPr.append(shd)


def add_image(doc, path, caption=None, max_w_cm=16.2):
    if not os.path.exists(path):
        add_para(doc, f"[缺少图片：{os.path.basename(path)}]", size=10, color="E5484D")
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(3)
    run = p.add_run()
    try:
        run.add_picture(path, width=Cm(max_w_cm))
    except Exception as exc:              # noqa: BLE001
        add_para(doc, f"[图片插入失败：{exc}]", size=9, color="E5484D")
        return
    if caption:
        cp = add_para(doc, caption, size=9.5, align=WD_ALIGN_PARAGRAPH.CENTER,
                      color="5A6270", space_after=8)


# ----------------------------------------------------------------------
# Markdown 解析
# ----------------------------------------------------------------------
IMG_RE = re.compile(r"!\[(?P<alt>[^\]]*)\]\((?P<src>[^)]+)\)")
CAPTION_MAP = {
    "01-用例图": "图 1  用例图",
    "02-系统架构图": "图 2  系统总体架构图",
    "03-数据库ER图": "图 3  数据库实体关系图（ER）",
    "04-业务流程图": "图 4  核心业务流程图",
    "05-状态机图": "图 5  信息记录状态机图",
    "06-页面导航图": "图 6  页面导航地图",
    "07-部署架构图": "图 7  部署架构图",
    "08-发布时序图": "图 8  发布信息接口时序图",
}


def render_markdown(doc, md_text, base_level=H1):
    lines = md_text.split("\n")
    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # 代码块
        if stripped.startswith("```"):
            i += 1
            block = []
            while i < n and not lines[i].strip().startswith("```"):
                block.append(lines[i].rstrip())
                i += 1
            i += 1
            add_code_block(doc, block)
            continue

        # 表格
        if stripped.startswith("|") and i + 1 < n and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1].strip()):
            rows = []
            header_cells = [c.strip() for c in stripped.strip("|").split("|")]
            rows.append(header_cells)
            i += 2
            while i < n and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            add_table(doc, rows)
            continue

        # 图片
        m = IMG_RE.search(stripped)
        if m:
            src = m.group("src").replace("../", "").replace("/", os.sep)
            key = os.path.splitext(os.path.basename(src))[0]
            png = os.path.join(IMG_DIR, key + ".png")
            if not os.path.exists(png):
                png = os.path.join(BASE, src)
            add_image(doc, png, CAPTION_MAP.get(key, m.group("alt") or None))
            i += 1
            continue

        # 标题
        if stripped.startswith("#"):
            lvl = len(stripped) - len(stripped.lstrip("#"))
            text = stripped[lvl:].strip()
            if lvl >= 1:
                add_heading(doc, text, min(base_level + lvl - 1, 4))
            i += 1
            continue

        # 分隔线
        if re.match(r"^-{3,}$", stripped):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            pPr = p._p.get_or_add_pPr()
            bd = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single")
            bottom.set(qn("w:sz"), "6")
            bottom.set(qn("w:color"), "D6DBE4")
            bd.append(bottom)
            pPr.append(bd)
            i += 1
            continue

        # 引用
        if stripped.startswith(">"):
            txt = stripped.lstrip("> ").strip()
            p = add_para(doc, "", indent=0.5, space_after=4)
            shade_para(p, "F7F8FA")
            add_inline_runs(p, txt, size=10, base_bold=False)
            i += 1
            continue

        # 列表
        lm = re.match(r"^(\s*)([-*+]|\d+\.)\s+(.*)$", raw)
        if lm:
            indent = len(lm.group(1)) // 2
            marker = lm.group(2)
            text = lm.group(3)
            bullet = "· " if marker in "-*+" else marker + " "
            p = add_para(doc, "", indent=0.55 + indent * 0.55, space_after=2, line=1.4)
            r = p.add_run(bullet)
            set_run_font(r, size=10.5, bold=False, color="5A6270")
            add_inline_runs(p, text, size=10.5)
            i += 1
            continue

        # 空行
        if not stripped:
            i += 1
            continue

        # 普通段落
        p = add_para(doc, "", space_after=5)
        add_inline_runs(p, stripped, size=10.5)
        i += 1


# ----------------------------------------------------------------------
# 封面 / 目录 / 页眉页脚
# ----------------------------------------------------------------------
def build_cover(doc):
    for _ in range(4):
        doc.add_paragraph()
    add_para(doc, TITLE, size=30, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
             color="1E4FD8", space_after=10)
    add_para(doc, SUBTITLE, size=13, align=WD_ALIGN_PARAGRAPH.CENTER, color="5A6270", space_after=28)

    info = [
        ("文档名称", "失物招领系统设计说明书"),
        ("文档版本", "V1.0"),
        ("系统定位", "校园 / 园区级极简版失物招领系统（仅发布与查询）"),
        ("技术栈", "Java 17 + Spring Boot 3 + MyBatis-Plus + MySQL 8 + Redis + Vue 3 + Element Plus"),
        ("交付性质", "仅设计，不含实现代码"),
        ("文档构成", "需求规格 · 概要设计 · 数据库设计 · 接口设计 · 详细设计 · 界面设计 · 测试与验收"),
    ]
    t = doc.add_table(rows=0, cols=2)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for k, v in info:
        cells = t.add_row().cells
        for idx, val in enumerate((k, v)):
            cells[idx].text = ""
            p = cells[idx].paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(val)
            set_run_font(r, size=10.5, bold=(idx == 0), color="1F2329" if idx else "2F6BFF")
        shade(cells[0], "EAF1FF")
    set_table_fixed(t, 15.0, [3.2, 11.8])
    doc.add_page_break()


def build_toc(doc):
    add_heading(doc, "目录", 1)
    p = doc.add_paragraph()
    run = p.add_run()
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), r'TOC \o "1-3" \h \z \u')
    inner = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "（在 Word 中按 F9 或右键「更新域」生成目录）"
    inner.append(t)
    fld.append(inner)
    p._p.append(fld)
    add_para(doc, "", space_after=6)
    doc.add_page_break()


def build_overview(doc):
    add_heading(doc, "文档说明", 1)
    add_para(doc, "本说明书由以下 8 份设计文档汇编而成，覆盖需求、概要设计、数据库、接口、详细设计、界面与测试验收：", space_after=6)
    rows = [["序号", "文档", "核心内容"]]
    contents = [
        ("01", "需求规格说明书", "背景与目标、范围边界、角色、功能需求（FR）、业务规则（BR）、非功能需求（NFR）、验收标准（AC）"),
        ("02", "概要设计说明书", "设计原则、分层架构、技术选型、部署架构、模块划分、关键设计决策、缓存与性能演进"),
        ("03", "数据库设计说明书", "ER 模型、8 张表结构、枚举字典、完整 DDL、统计视图、初始化数据、数据维护策略"),
        ("04", "接口设计说明书", "RESTful 约定、统一响应体、错误码表、全部接口明细、鉴权设计、限流策略、请求示例"),
        ("05", "详细设计说明书", "核心时序、状态流转、类与方法设计、关键算法（检索 / 分页 / 图片 / 去重）、事务与异常、配置项"),
        ("06", "界面设计说明书", "页面清单、导航地图、设计令牌、逐页布局与交互、组件树、文案规范"),
        ("07", "测试与验收设计", "测试策略、用例矩阵（账号 / 发布 / 检索 / 详情 / 管理 / 安全 / 性能）、验收清单、上线检查项"),
        ("08", "界面与功能说明", "静态原型的位置与打开方式、7 个界面的功能说明、界面与需求编号/接口的对应关系"),
    ]
    for r in contents:
        rows.append(list(r))
    add_table(doc, rows, widths=[1.4, 4.6, 10.2])

    add_para(doc, "设计图清单", size=12, bold=True, space_before=8, space_after=4)
    figs = [["图号", "名称", "对应章节"]]
    for r in [("图 1", "用例图", "01 需求规格说明书 §4.1"),
              ("图 2", "系统总体架构图", "02 概要设计说明书 §2.1"),
              ("图 3", "数据库实体关系图（ER）", "03 数据库设计说明书 §2"),
              ("图 4", "核心业务流程图", "05 详细设计说明书 §1"),
              ("图 5", "信息记录状态机图", "05 详细设计说明书 §1.4"),
              ("图 6", "页面导航地图", "06 界面设计说明书 §2"),
              ("图 7", "部署架构图", "02 概要设计说明书 §2.3"),
              ("图 8", "发布信息接口时序图", "05 详细设计说明书 §1.1")]:
        figs.append(list(r))
    add_table(doc, figs, widths=[1.8, 6.4, 8.0])
    doc.add_page_break()


def set_page(sec):
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(2.4)
    sec.right_margin = Cm(2.4)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.0)


def add_header_footer(sec, text):
    hdr = sec.header.paragraphs[0]
    hdr.text = ""
    hdr.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = hdr.add_run(text)
    set_run_font(r, size=9, color="8A93A0")

    ftr = sec.footer.paragraphs[0]
    ftr.text = ""
    ftr.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = ftr.add_run("第 ")
    set_run_font(r1, size=9, color="8A93A0")
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    r_el = OxmlElement("w:r")
    t_el = OxmlElement("w:t")
    t_el.text = "1"
    r_el.append(t_el)
    fld.append(r_el)
    ftr._p.append(fld)
    r2 = ftr.add_run(" 页")
    set_run_font(r2, size=8.5, color="8A93A0")


# ----------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------
def main():
    doc = Document()
    # 默认样式
    style = doc.styles["Normal"]
    style.font.name = EN_FONT
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)

    set_page(doc.sections[0])
    build_cover(doc)

    sec0 = doc.sections[0]
    add_header_footer(sec0, "失物招领系统设计说明书")

    build_toc(doc)
    build_overview(doc)

    missing = []
    for idx, (title, filename) in enumerate(DOCS):
        path = os.path.join(BASE, filename)
        if not os.path.exists(path):
            missing.append(filename)
            continue
        if idx > 0:
            doc.add_page_break()
        add_heading(doc, f"第 {idx + 1} 部分  {title}", 1)
        with open(path, "r", encoding="utf-8") as f:
            render_markdown(doc, f.read(), base_level=H2)
        print("  +", filename)

    # 附录：交付物清单
    doc.add_page_break()
    add_heading(doc, "附录  交付物清单", 1)
    rows = [["类别", "交付物", "说明"]]
    for r in [("设计文档", "01 ~ 07 共 7 份 Markdown 文档", "可直接纳入项目 wiki 或版本库"),
              ("正式文档", "失物招领系统设计说明书.docx", "本文件，汇编全部设计内容"),
              ("设计图", "图/01 ~ 08 PNG（8 张）", "用于文档嵌入与汇报"),
              ("设计图源文件", "图/*.svg", "矢量源文件，可无损缩放与二次编辑"),
              ("脚本", "make_diagrams.py / make_docx.py", "设计图与本文档的生成脚本，可重复执行")]:
        rows.append(list(r))
    add_table(doc, rows, widths=[2.6, 6.0, 7.6])
    add_para(doc, "说明：本次交付仅包含设计成果，不含任何实现代码；所有表结构、接口、错误码均已对齐，可直接作为开发依据。",
             size=10, color="5A6270", space_before=6)

    doc.save(OUT)
    print("已生成：", OUT)
    if missing:
        print("警告：以下源文件缺失 ->", ", ".join(missing))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
