#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OA 优惠券填报 skill 专用 .xlsx 读取器（仅用 Python 标准库，零依赖）。

用法：
  python3 parse_xlsx.py FILE.xlsx                          # 每个工作表预览（markdown）
  python3 parse_xlsx.py FILE.xlsx --sheet 100减1           # 只看指定工作表
  python3 parse_xlsx.py FILE.xlsx --format json            # 结构化输出
  python3 parse_xlsx.py FILE.xlsx --agg 'SKUID:unique_count' --header-row 1
  python3 parse_xlsx.py FILE.xlsx --agg '链接状态:value_counts'
  python3 parse_xlsx.py FILE.xlsx --all                    # 不截断行

说明：
- 公式单元格显示缓存值；无缓存值时显示 "=公式"，避免静默丢数。
- 日期单元格按样式自动转换为 YYYY-MM-DD（或含时间）。
- agg 统计默认跳过表头行，只统计非空值。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
BUILTIN_DATE_IDS = {
    14, 15, 16, 17, 18, 19, 20, 21, 22,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
}


def strip_ns(root: ET.Element) -> None:
    for el in root.iter():
        el.tag = el.tag.split("}")[-1]
        el.attrib = {k.split("}")[-1]: v for k, v in el.attrib.items()}


def col_to_index(ref: str) -> int:
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return max(n - 1, 0)


def load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strip_ns(root)
    return ["".join(t.text or "" for t in si.iter("t")) for si in root.findall("si")]


def load_styles(zf: zipfile.ZipFile):
    """返回 (is_date_style(s_idx) 函数)。"""
    custom_codes: dict[int, str] = {}
    xfs: list[int] = []
    try:
        root = ET.fromstring(zf.read("xl/styles.xml"))
    except KeyError:
        return lambda s: False
    strip_ns(root)
    for nf in root.iter("numFmt"):
        try:
            custom_codes[int(nf.get("numFmtId"))] = nf.get("formatCode") or ""
        except (TypeError, ValueError):
            continue
    for xf in root.iter("xf"):
        try:
            xfs.append(int(xf.get("numFmtId", "0")))
        except ValueError:
            xfs.append(0)

    def is_date_style(s_idx) -> bool:
        if s_idx is None:
            return False
        try:
            nid = xfs[int(s_idx)]
        except (ValueError, IndexError):
            return False
        if nid in BUILTIN_DATE_IDS:
            return True
        code = custom_codes.get(nid, "").lower()
        return bool(code) and ("y" in code or "d" in code) and "#" not in code

    return is_date_style


def excel_date(serial: float) -> str:
    # Excel 1900 日期系统：serial<60 时基准为 1899-12-31，之后为 1899-12-30
    base = dt.datetime(1899, 12, 30) if serial >= 60 else dt.datetime(1899, 12, 31)
    moment = base + dt.timedelta(days=serial)
    if moment.hour == 0 and moment.minute == 0 and moment.second == 0:
        return moment.strftime("%Y-%m-%d")
    return moment.strftime("%Y-%m-%d %H:%M:%S")


def sheet_targets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    strip_ns(wb)
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    strip_ns(rels)
    rid_to_target = {r.get("Id"): r.get("Target") for r in rels}
    out = []
    for sh in wb.iter("sheet"):
        rid = sh.get(REL_NS) or sh.get("id")
        target = rid_to_target.get(rid, "") or ""
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        out.append((sh.get("name") or "", target))
    return out


def read_sheet(zf, path, shared, is_date_style) -> list[list[str]]:
    root = ET.fromstring(zf.read(path))
    strip_ns(root)
    rows: list[list[str]] = []
    for row in root.iter("row"):
        cells: dict[int, str] = {}
        for c in row.findall("c"):
            ref = c.get("r") or ""
            col = col_to_index(ref) if ref else max(cells) + 1 if cells else 0
            t = c.get("t")
            s = c.get("s")
            f = c.find("f")
            v = c.find("v")
            isel = c.find("is")
            raw: str | None = None
            if t == "s" and v is not None and v.text is not None:
                try:
                    raw = shared[int(float(v.text))]
                except (ValueError, IndexError):
                    raw = None
            elif t == "inlineStr" and isel is not None:
                raw = "".join(t2.text or "" for t2 in isel.iter("t"))
            elif v is not None and v.text is not None:
                raw = v.text
            value: str | None = raw
            if raw is not None and t in (None, "n"):
                try:
                    num = float(raw)
                    value = excel_date(num) if is_date_style(s) else (
                        str(int(num)) if num.is_integer() else str(num)
                    )
                except (ValueError, OverflowError):
                    value = raw
            elif t == "b" and raw is not None:
                value = "TRUE" if raw.strip() in ("1", "true") else "FALSE"
            if value is None and f is not None and f.text:
                value = "=" + f.text  # 公式无缓存值：显式标出而非留空
            if value is not None:
                cells[col] = str(value).replace("\n", " ").replace("|", "\\|")
        width = (max(cells) + 1) if cells else 0
        rows.append([cells.get(i, "") for i in range(width)])
    return rows


def render_markdown(sheets: dict[str, list[list[str]]], max_rows: int, title: str) -> str:
    lines = [f"# {title}", ""]
    for name, rows in sheets.items():
        lines.append(f"## Sheet: {name}（共 {len(rows)} 行）")
        lines.append("")
        shown = rows if max_rows <= 0 else rows[:max_rows]
        width = max((len(r) for r in shown), default=0)
        for i, row in enumerate(shown):
            padded = row + [""] * (width - len(row))
            lines.append("| " + " | ".join(padded) + " |")
            if i == 0 and len(shown) > 1:
                lines.append("|" + "---|" * width)
        if max_rows > 0 and len(rows) > max_rows:
            lines.append(f"…（其余 {len(rows) - max_rows} 行未显示，可用 --all 或 --agg 查看）")
        lines.append("")
    return "\n".join(lines)


def aggregate(sheets, agg_spec: str, header_row: int) -> str:
    try:
        column, func = agg_spec.rsplit(":", 1)
    except ValueError:
        raise SystemExit(f"--agg 格式应为 '列名:func'，收到：{agg_spec}")
    if func not in {"count", "unique_count", "value_counts", "sum"}:
        raise SystemExit(f"不支持的 agg 函数：{func}（可用 count/unique_count/value_counts/sum）")
    out = [f"# agg: {agg_spec}", ""]
    for name, rows in sheets.items():
        if not rows:
            out.append(f"## Sheet: {name}（空）")
            continue
        header = rows[min(header_row, len(rows)) - 1]
        if column not in header:
            out.append(f"## Sheet: {name}：表头（第 {header_row} 行）找不到列「{column}」，表头为：{header}")
            continue
        col_idx = header.index(column)
        values = [
            (r[col_idx] if col_idx < len(r) else "")
            for r in rows[header_row:]
        ]
        values = [v for v in values if v != ""]
        if func == "count":
            out.append(f"## Sheet: {name}「{column}」非空计数：{len(values)}")
        elif func == "unique_count":
            out.append(f"## Sheet: {name}「{column}」去重计数：{len(set(values))}")
        elif func == "sum":
            total = 0.0
            bad = 0
            for v in values:
                try:
                    total += float(v.replace(",", ""))
                except ValueError:
                    bad += 1
            total_s = str(int(total)) if abs(total - round(total)) < 1e-9 else f"{total:.2f}"
            out.append(
                f"## Sheet: {name}「{column}」求和：{total_s}（非数值 {bad} 个已跳过）"
            )
        else:
            dist = {}
            for v in values:
                dist[v] = dist.get(v, 0) + 1
            pretty = "；".join(f"{k}={n}" for k, n in sorted(dist.items(), key=lambda x: -x[1]))
            out.append(f"## Sheet: {name}「{column}」取值分布：{pretty or '（无非空值）'}")
        out.append("")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description="读取 .xlsx 并输出预览/JSON/统计")
    ap.add_argument("file")
    ap.add_argument("--sheet", action="append", default=[], help="只输出指定名称的工作表，可重复")
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--max-rows", type=int, default=60, help="markdown 模式每表最多显示行数，0 不限")
    ap.add_argument("--all", action="store_true", help="显示全部行（等同 --max-rows 0）")
    ap.add_argument("--agg", help="统计模式：'列名:count|unique_count|value_counts|sum'")
    ap.add_argument("--header-row", type=int, default=1, help="agg 模式的表头所在行（从 1 起）")
    args = ap.parse_args()

    with zipfile.ZipFile(args.file) as zf:
        shared = load_shared_strings(zf)
        is_date_style = load_styles(zf)
        wanted = set(args.sheet)
        sheets: dict[str, list[list[str]]] = {}
        for name, target in sheet_targets(zf):
            if wanted and name not in wanted:
                continue
            sheets[name] = read_sheet(zf, target, shared, is_date_style)

    if not sheets:
        known = ", ".join(n for n, _ in sheet_targets(zipfile.ZipFile(args.file)))
        raise SystemExit(f"未找到工作表。--sheet 可选值：{known}")

    if args.agg:
        sys.stdout.write(aggregate(sheets, args.agg, args.header_row))
        return
    if args.format == "json":
        json.dump(
            {
                "file": args.file,
                "sheets": [
                    {"name": n, "rowCount": len(r), "rows": r} for n, r in sheets.items()
                ],
            },
            sys.stdout,
            ensure_ascii=False,
        )
        sys.stdout.write("\n")
        return
    sys.stdout.write(render_markdown(sheets, 0 if args.all else args.max_rows, args.file))


if __name__ == "__main__":
    main()
