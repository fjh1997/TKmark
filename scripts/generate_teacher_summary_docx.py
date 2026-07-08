#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
from datetime import date
from html import escape
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile


DEFAULT_SUMMARY = [
    "本学期主要承担信安24-01、信安24实验班、信安2504等班级《信息安全与代码审计》课程教学工作。课程围绕 Web 安全漏洞原理、Java 代码审计方法、漏洞利用验证和修复思路展开，突出“源码阅读、漏洞定位、靶场验证、报告复盘”的实践闭环。教学中结合 XSS Cookie 窃取、Cookie/Session 猜解、文件上传、SQL 注入、业务逻辑漏洞、Java 反射、反序列化、SSRF、Log4j 等案例，引导学生从代码层面理解漏洞成因，并通过靶场环境完成验证。",
    "在课堂组织上，本学期继续采用案例讲解与实操训练结合的方式，通过关键代码分析、漏洞复现演示和学生独立实验，提高学生的动手能力和安全分析意识。作业批改方面，依托超星学习通收集实验结果，围绕关键证据、URL 路径、payload、命令执行结果、DNSLog/RCE 结果等要素细化评分标准；对相似作业结合图片特征、提交时间和复核记录进行判断，尽量做到评分有依据、过程可追溯。",
    "在课程考核方面，期末考试更加突出代码审计和实操能力，重点考查学生对漏洞入口、利用过程、flag、关键证据和修复思路的掌握情况。考试后对客观题自动判分、主观题作答质量和 flag 格式近似等情况进行了复核，对确有格式误差但能证明完成实验的答案进行合理修正，对空题和缺少关键证据的答案坚持不补分。同时综合平时作业、课堂表现、考勤和期末成绩，兼顾评价公平性与成绩区分度。",
    "总体来看，学生对代码审计课程的理解和实践能力有所提升，部分学生已能较完整地完成漏洞定位、利用验证和实验报告撰写。后续将继续优化实验指导书、评分 Rubric 和教学案例，补充常见错误说明，沉淀视频资源和自动化批改工具，进一步提升课堂效率和作业反馈质量。",
]

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate the teacher teaching-summary docx.")
    parser.add_argument("--out", required=True, help="output .docx path")
    parser.add_argument("--txt-out", default="", help="optional plain text output path")
    parser.add_argument("--teacher-name", default="傅继晗")
    parser.add_argument("--classes", default="信安24-01、信安24实验班、信安2504")
    parser.add_argument("--department", default="信息安全技术应用")
    parser.add_argument("--course", default="信息安全与代码审计")
    parser.add_argument("--school-year", default="2025-2026")
    parser.add_argument("--term", default="二")
    parser.add_argument("--date", default=date.today().isoformat(), help="YYYY-MM-DD")
    parser.add_argument("--summary-file", default="", help="UTF-8 text file; blank lines split paragraphs")
    parser.add_argument("--teaching-plan-docx", default="", help="optional 授课计划 docx to infer single-course hours")
    parser.add_argument(
        "--class-hours",
        default="",
        help="comma-separated class hours, e.g. 60,60,62 or 信安24-01=60,实验班=60",
    )
    parser.add_argument("--total-hours", type=int, default=0)
    parser.add_argument("--theory-hours", type=int, default=0)
    parser.add_argument("--practice-hours", type=int, default=0)
    return parser.parse_args()


def xml_text(value: str, size: int = 20, bold: bool = False) -> str:
    bold_xml = "<w:b/>" if bold else ""
    parts = []
    for index, part in enumerate(value.split("\n")):
        if index:
            parts.append("<w:br/>")
        parts.append(f'<w:t xml:space="preserve">{escape(part, quote=False)}</w:t>')
    return (
        f"<w:r><w:rPr>{bold_xml}"
        f'<w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="{size}"/>'
        f"</w:rPr>{''.join(parts)}</w:r>"
    )


def paragraph(
    value: str = "",
    *,
    align: str = "center",
    size: int = 20,
    bold: bool = False,
    after: int = 0,
    line: int = 220,
    first_line: int = 0,
) -> str:
    indent = f'<w:ind w:firstLine="{first_line}"/>' if first_line else ""
    return (
        f"<w:p><w:pPr><w:jc w:val=\"{align}\"/>"
        f'<w:spacing w:after="{after}" w:line="{line}" w:lineRule="auto"/>{indent}</w:pPr>'
        f"{xml_text(value, size, bold)}</w:p>"
    )


def blank_signature() -> str:
    items = ["<w:t></w:t><w:br/>" for _ in range(4)]
    items.append('<w:t xml:space="preserve">签名：</w:t>')
    return (
        '<w:p><w:pPr><w:jc w:val="center"/>'
        '<w:spacing w:after="0" w:line="220" w:lineRule="auto"/></w:pPr>'
        '<w:r><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/>'
        f"</w:rPr>{''.join(items)}</w:r></w:p>"
    )


def vertical_label(value: str) -> str:
    value = value.replace("（", "︵").replace("）", "︶")
    return "\n".join(value)


def cell(
    value: str = "",
    *,
    width: int,
    gridspan: int = 0,
    vmerge: str = "",
    valign: str = "center",
    size: int = 20,
    bold: bool = False,
    align: str = "center",
    body: list[str] | None = None,
) -> str:
    props = [f'<w:tcW w:w="{width}" w:type="dxa"/>']
    if gridspan:
        props.append(f'<w:gridSpan w:val="{gridspan}"/>')
    if vmerge == "restart":
        props.append('<w:vMerge w:val="restart"/>')
    elif vmerge == "continue":
        props.append("<w:vMerge/>")
    props.append(f'<w:vAlign w:val="{valign}"/>')
    props.append(
        '<w:tcMar><w:top w:w="65" w:type="dxa"/><w:left w:w="65" w:type="dxa"/>'
        '<w:bottom w:w="65" w:type="dxa"/><w:right w:w="65" w:type="dxa"/></w:tcMar>'
    )
    content = "".join(body) if body is not None else paragraph(value, align=align, size=size, bold=bold)
    return f"<w:tc><w:tcPr>{''.join(props)}</w:tcPr>{content}</w:tc>"


def row(cells: list[str], height: int) -> str:
    return f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="atLeast"/></w:trPr>{"".join(cells)}</w:tr>'


def parse_class_hours(value: str) -> list[int]:
    if not value.strip():
        return []
    hours = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        if "=" in item:
            item = item.split("=", 1)[1]
        hours.append(int(item))
    return hours


def read_docx_text_cells(path: Path) -> list[list[str]]:
    ns = {"w": WORD_NS}
    with ZipFile(path) as archive:
        xml = archive.read("word/document.xml")
    root = ET.fromstring(xml)
    rows = []
    for tr in root.findall(".//w:tbl/w:tr", ns):
        row_cells = []
        for tc in tr.findall("w:tc", ns):
            row_cells.append("".join(t.text or "" for t in tc.findall(".//w:t", ns)).strip())
        rows.append(row_cells)
    return rows


def infer_plan_hours(path: str) -> tuple[int, int, int]:
    if not path:
        return 0, 0, 0
    rows = read_docx_text_cells(Path(path))
    actual = theory = practice = 0
    for index, cells in enumerate(rows):
        text = "|".join(cells)
        if "计划学时" in text and "实际学时" in text and index + 1 < len(rows):
            nums = [int(x) for x in re.findall(r"\d+", "|".join(rows[index + 1]))]
            if len(nums) >= 2:
                actual = nums[1]
        if "理论教学学时" in text and "实践教学学时" in text and index + 1 < len(rows):
            nums = [int(x) for x in re.findall(r"\d+", "|".join(rows[index + 1]))]
            if len(nums) >= 2:
                theory, practice = nums[0], nums[1]
    return actual, theory, practice


def resolve_hours(args: argparse.Namespace) -> tuple[int, int, int]:
    total, theory, practice = args.total_hours, args.theory_hours, args.practice_hours
    class_hours = parse_class_hours(args.class_hours)
    if class_hours and not total:
        total = sum(class_hours)
    if total and not theory and not practice:
        theory = total // 2
        practice = total - theory
    if not (total and theory and practice):
        plan_total, plan_theory, plan_practice = infer_plan_hours(args.teaching_plan_docx)
        total = total or plan_total
        theory = theory or plan_theory
        practice = practice or plan_practice
    if not (total and theory and practice):
        raise SystemExit("hours are missing; pass --theory-hours/--practice-hours or --class-hours")
    return total, theory, practice


def read_summary(args: argparse.Namespace) -> list[str]:
    if not args.summary_file:
        return DEFAULT_SUMMARY
    text = Path(args.summary_file).read_text(encoding="utf-8")
    return [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]


def document_xml(args: argparse.Namespace, theory: int, practice: int, summary: list[str]) -> str:
    y, m, d = args.date.split("-")
    cols = [800, 1150, 1400, 3300, 900, 1250, 900, 300]
    summary_body = [paragraph(p, align="left", size=18, line=230, first_line=360) for p in summary]
    parts = [
        paragraph("浙江同济科技职业学院教师（教学）个人小结", size=28, bold=True, after=80, line=260),
        paragraph(
            f"{args.school_year}学年第  {args.term}  学期（期末）                         日期  {y}  年  {int(m)}  月  {int(d)}  日",
            size=20,
            bold=True,
            after=50,
            line=230,
        ),
    ]
    table = [
        '<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:jc w:val="center"/>'
        '<w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="10"/>'
        '<w:left w:val="single" w:sz="10"/><w:bottom w:val="single" w:sz="10"/>'
        '<w:right w:val="single" w:sz="10"/><w:insideH w:val="single" w:sz="10"/>'
        '<w:insideV w:val="single" w:sz="10"/></w:tblBorders></w:tblPr>',
        "<w:tblGrid>" + "".join(f'<w:gridCol w:w="{w}"/>' for w in cols) + "</w:tblGrid>",
        row(
            [
                cell("姓名", width=cols[0], bold=True),
                cell(args.teacher_name, width=cols[1]),
                cell("所在班级", width=cols[2], bold=True),
                cell(args.classes, width=cols[3], size=17),
                cell(vertical_label("总授课数"), width=cols[4], vmerge="restart", bold=True),
                cell("理论课时", width=cols[5], bold=True),
                cell(str(theory), width=cols[6] + cols[7], gridspan=2),
            ],
            780,
        ),
        row(
            [
                cell("所属专\n业部", width=cols[0], bold=True),
                cell(args.department, width=cols[1], size=17),
                cell("所在课程", width=cols[2], bold=True),
                cell(args.course, width=cols[3], size=18),
                cell("", width=cols[4], vmerge="continue"),
                cell("实训课时", width=cols[5], bold=True),
                cell(str(practice), width=cols[6] + cols[7], gridspan=2),
            ],
            780,
        ),
        row(
            [
                cell(vertical_label("小结内容（不够另附纸）"), width=cols[0], bold=True),
                cell("", width=sum(cols[1:]), gridspan=7, valign="top", body=summary_body),
            ],
            6900,
        ),
        row(
            [
                cell(vertical_label("教研室意见"), width=cols[0], bold=True),
                cell("", width=sum(cols[1:]), gridspan=7, valign="bottom", body=[blank_signature()]),
            ],
            1750,
        ),
        row(
            [
                cell(vertical_label("系（部）意见"), width=cols[0], bold=True),
                cell("", width=sum(cols[1:]), gridspan=7, valign="bottom", body=[blank_signature()]),
            ],
            1750,
        ),
        "</w:tbl>",
    ]
    parts.extend(table)
    parts.append(paragraph("此表一式二份，教研室、系（部）各执一份", size=18, bold=True, line=200))
    parts.append(
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="900" w:right="720" w:bottom="650" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>'
        "</w:sectPr>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n'
        f"<w:body>\n{chr(10).join(parts)}\n</w:body></w:document>"
    )


def write_docx(path: Path, xml: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            "</Relationships>"
        ),
        "word/_rels/document.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
        ),
        "word/styles.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
            '<w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="宋体" w:eastAsia="宋体"/><w:sz w:val="20"/></w:rPr>'
            "</w:style></w:styles>"
        ),
        "docProps/core.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>教师教学个人小结</dc:title></cp:coreProperties>'
        ),
        "docProps/app.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>'
        ),
        "word/document.xml": xml,
    }
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content.encode("utf-8"))


def write_plain_text(path: Path, args: argparse.Namespace, total: int, theory: int, practice: int, summary: list[str]) -> None:
    if not path:
        return
    text = "\n".join(
        [
            "浙江同济科技职业学院教师（教学）个人小结",
            f"{args.school_year}学年第  {args.term}  学期（期末）    日期  {args.date}",
            f"姓名：{args.teacher_name}",
            f"所在班级：{args.classes}",
            f"所属专业部：{args.department}",
            f"所在课程：{args.course}",
            f"总授课数：{total}；理论课时：{theory}；实训课时：{practice}",
            "",
            "小结内容：",
            *summary,
            "",
            "教研室意见：",
            "签名：",
            "",
            "系（部）意见：",
            "签名：",
            "",
            "此表一式二份，教研室、系（部）各执一份",
            "",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    total, theory, practice = resolve_hours(args)
    summary = read_summary(args)
    out = Path(args.out)
    write_docx(out, document_xml(args, theory, practice, summary))
    if args.txt_out:
        write_plain_text(Path(args.txt_out), args, total, theory, practice, summary)
    print(out)


if __name__ == "__main__":
    main()
