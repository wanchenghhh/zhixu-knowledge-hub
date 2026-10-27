"""Regression coverage for source boundaries, literal delimiters and token budgets."""

import time
from types import SimpleNamespace
import pytest
from app.processing import split_custom, split_structural, prepare_file, text_length
from app.schemas import ParseOptions


def options(**values):
    return ParseOptions(extractMetadata=False, chunkSize=80, overlap=0, **values).model_dump()


def source(text, index=0, **metadata):
    return {"text": text, "location": f"位置 {index}", "metadata": metadata}


def test_page_and_parent_never_mix_pages():
    blocks = [
        source("PAGE_ONE " * 20, page=1),
        source("PAGE_ONE_TABLE", kind="table", page=1),
        source("PAGE_TWO " * 20, page=2),
    ]
    file = SimpleNamespace(
        options=options(strategy="custom", boundary="page"), blocks=blocks, preparation={}, metadata_values={}
    )
    rows = prepare_file(
        SimpleNamespace(commit=lambda: None),
        SimpleNamespace(processing_config={}),
        file,
        SimpleNamespace(usage={}),
        time.monotonic() + 30,
    )
    assert rows and all(not ("PAGE_ONE" in row["text"] and "PAGE_TWO" in row["text"]) for row in rows)
    assert all(
        not ("PAGE_ONE" in row["metadata"]["parentText"] and "PAGE_TWO" in row["metadata"]["parentText"])
        for row in rows
    )
    assert next(row for row in rows if "PAGE_TWO" in row["text"])["metadata"]["block_index"] == 2


def test_page_requires_actual_page_numbers():
    with pytest.raises(ValueError, match="真实页码"):
        split_custom([source("Markdown without page numbers")], options(strategy="custom", boundary="page"))


def test_heading_levels_keep_subsections_with_their_chapter():
    blocks = [
        source("# 总则\n正文"),
        source("## 第一章\n规则A", 1),
        source("### 子节\n细则A", 2),
        source("## 第二章\n规则B", 3),
    ]
    docs = split_custom(blocks, options(strategy="custom", boundary="heading", headingLevel=2))
    assert len(docs) == 3
    assert "细则A" in docs[1].page_content and "规则B" not in docs[1].page_content
    assert docs[2].metadata["block_index"] == 3


@pytest.mark.parametrize(
    "position,expected",
    [
        ("start", ["甲", "[.*]乙", "[.*]丙"]),
        ("end", ["甲[.*]", "乙[.*]", "丙"]),
        ("remove", ["甲", "乙", "丙"]),
    ],
)
def test_symbols_are_literal_and_marker_placement_is_explicit(position, expected):
    docs = split_custom(
        [source("甲[.*]乙[.*]丙")],
        options(strategy="custom", boundary="delimiter", delimiters=["[.*]"], delimiterPosition=position),
    )
    assert [d.page_content for d in docs] == expected


def test_regex_captures_do_not_become_separate_chunks():
    docs = split_custom(
        [source("第一章 甲\n第二章 乙")],
        options(strategy="custom", boundary="regex", separator=r"第(一|二)章"),
    )
    assert [d.page_content for d in docs] == ["第一章 甲", "第二章 乙"]


def test_token_limit_uses_real_offline_encoding_without_losing_unicode():
    value = "企业知识库，按语义检索与回答。Hello world! " * 10
    config = options(strategy="custom", boundary="length", lengthUnit="tokens")
    docs = split_custom([source(value)], config)
    assert all(text_length(d.page_content, config) <= 80 for d in docs)
    assert "".join(d.page_content for d in docs).replace(" ", "") == value.replace(" ", "")


def test_table_headers_can_be_repeated_or_only_kept_once():
    blocks = [
        source("城市 | 标准\n--- | ---\n" + "\n".join(f"城市{i} | 500元" for i in range(20)), kind="table")
    ]
    repeated = split_structural(blocks, options(tableHeader=True))
    single = split_structural(blocks, options(tableHeader=False))
    assert len(repeated) > 1 and all("城市 | 标准" in d.page_content for d in repeated)
    assert sum("城市 | 标准" in d.page_content for d in single) == 1
    assert all(f"城市{i} | 500元" in "\n".join(d.page_content for d in single) for i in range(20))
