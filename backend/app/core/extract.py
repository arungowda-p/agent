"""Text extraction and chunking for PDF, DOCX, PPTX, XLSX, CSV, HTML, Markdown and plain text.

DOCX and PPTX are parsed directly from their OOXML zip containers with the standard library,
keeping the serverless bundle small (no lxml / Pillow).
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


@dataclass(slots=True)
class Section:
    location: str
    text: str


@dataclass(slots=True)
class TextChunk:
    location: str
    ordinal: int
    text: str


class _HTMLText(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form"}
    BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "section", "article", "td"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title = ""
        self._skip_depth = 0
        self._in_title = False
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title":
            self._in_title = False
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data.strip()
            return
        if not self._skip_depth:
            self.parts.append(data)

    def text(self) -> str:
        joined = "".join(self.parts)
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in joined.splitlines()]
        return "\n".join(line for line in lines if line)


def parse_html(html: str) -> tuple[str, str, list[str]]:
    parser = _HTMLText()
    parser.feed(html)
    parser.close()
    return parser.title, parser.text(), parser.links


def _pdf_sections(data: bytes) -> list[Section]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    sections: list[Section] = []
    for index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            sections.append(Section(location=f"Page {index}", text=text))
    return sections


def _docx_sections(data: bytes) -> list[Section]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    sections: list[Section] = []
    heading = "Document"
    buffer: list[str] = []
    for paragraph in root.iter(f"{W_NS}p"):
        style = paragraph.find(f"{W_NS}pPr/{W_NS}pStyle")
        style_name = style.get(f"{W_NS}val", "") if style is not None else ""
        text = "".join(node.text or "" for node in paragraph.iter(f"{W_NS}t")).strip()
        if not text:
            continue
        if style_name.lower().startswith("heading") or style_name.lower() == "title":
            if buffer:
                sections.append(Section(location=heading, text="\n".join(buffer)))
                buffer = []
            heading = text[:80]
            buffer.append(text)
        else:
            buffer.append(text)
    if buffer:
        sections.append(Section(location=heading, text="\n".join(buffer)))
    return sections


def _slide_number(name: str) -> int:
    match = re.search(r"(\d+)\.xml$", name)
    return int(match.group(1)) if match else 0


def _pptx_sections(data: bytes) -> list[Section]:
    sections: list[Section] = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        slides = sorted(
            (n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=_slide_number
        )
        for slide_name in slides:
            number = _slide_number(slide_name)
            root = ElementTree.fromstring(archive.read(slide_name))
            body = " ".join((node.text or "").strip() for node in root.iter(f"{A_NS}t")).strip()
            notes_name = f"ppt/notesSlides/notesSlide{number}.xml"
            notes = ""
            if notes_name in names:
                notes_root = ElementTree.fromstring(archive.read(notes_name))
                notes = " ".join((n.text or "").strip() for n in notes_root.iter(f"{A_NS}t")).strip()
            text = body if not notes else f"{body}\nSpeaker notes: {notes}"
            if text.strip():
                sections.append(Section(location=f"Slide {number}", text=text))
    return sections


def _xlsx_sections(data: bytes) -> list[Section]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sections: list[Section] = []
    for sheet in workbook.worksheets:
        for row_index, row in enumerate(sheet.iter_rows(values_only=True), start=1):
            cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
            if cells:
                sections.append(Section(location=f"{sheet.title}!R{row_index}", text=" | ".join(cells)))
    workbook.close()
    return sections


def _csv_sections(data: bytes) -> list[Section]:
    reader = csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace")))
    sections: list[Section] = []
    for row_index, row in enumerate(reader, start=1):
        cells = [c.strip() for c in row if c and c.strip()]
        if cells:
            sections.append(Section(location=f"Row {row_index}", text=" | ".join(cells)))
    return sections


def _text_sections(text: str, label: str = "Section") -> list[Section]:
    blocks: list[Section] = []
    heading = label
    buffer: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            if buffer:
                blocks.append(Section(location=heading, text="\n".join(buffer)))
                buffer = []
            heading = stripped.lstrip("#").strip()[:80] or label
            stripped = stripped.lstrip("#").strip()
        if stripped:
            buffer.append(stripped)
    if buffer:
        blocks.append(Section(location=heading, text="\n".join(buffer)))
    return blocks


def extract_sections(path: Path) -> list[Section]:
    data = path.read_bytes()
    ext = path.suffix.lower()
    if ext == ".pdf":
        return _pdf_sections(data)
    if ext == ".docx":
        return _docx_sections(data)
    if ext == ".pptx":
        return _pptx_sections(data)
    if ext == ".xlsx":
        return _xlsx_sections(data)
    if ext == ".csv":
        return _csv_sections(data)
    if ext in {".html", ".htm"}:
        title, text, _ = parse_html(data.decode("utf-8", errors="replace"))
        return _text_sections(text, title or "Page")
    return _text_sections(data.decode("utf-8", errors="replace"))


def chunk_sections(sections: list[Section], *, target_chars: int = 1000, overlap_chars: int = 150) -> list[TextChunk]:
    """Split sections into overlapping, sentence-aligned chunks while keeping their location label."""
    chunks: list[TextChunk] = []
    ordinal = 0
    for section in sections:
        text = re.sub(r"\s+\n", "\n", section.text).strip()
        if len(text) <= target_chars:
            chunks.append(TextChunk(location=section.location, ordinal=ordinal, text=text))
            ordinal += 1
            continue
        sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
        current = ""
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            if current and len(current) + len(sentence) + 1 > target_chars:
                chunks.append(TextChunk(location=section.location, ordinal=ordinal, text=current.strip()))
                ordinal += 1
                current = current[-overlap_chars:] + " " + sentence
            else:
                current = f"{current} {sentence}" if current else sentence
        if current.strip():
            chunks.append(TextChunk(location=section.location, ordinal=ordinal, text=current.strip()))
            ordinal += 1
    return chunks
