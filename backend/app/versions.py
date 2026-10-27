"""Effective versions and typed metadata predicates shared by every retrieval entrypoint."""

from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import select
from .db import File
from .processing import metadata_value, field_schema


def current_files(db, kb_id):
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    groups = {}
    files = list(db.scalars(select(File).where(File.kb_id == kb_id, File.activated.is_not(None))))
    dated_by_group = {}
    for row in files:
        if row.effective_on and row.effective_on <= today:
            key = row.document_group or row.id
            dated_by_group[key] = max(dated_by_group.get(key, row.activated), row.activated)
    for file in files:
        if file.effective_on and file.effective_on > today:
            continue
        group = file.document_group or file.id
        implicit_date = file.activated.date().isoformat()
        if not file.effective_on and dated_by_group.get(group, file.activated) > file.activated:
            implicit_date = "0001-01-01"
        rank = (file.effective_on or implicit_date, file.activated, file.id)
        if group not in groups or rank > groups[group][0]:
            groups[group] = (rank, file)
    # Disabled current versions do not silently reactivate obsolete historical versions.
    return {
        row.id
        for _, row in groups.values()
        if row.status == "ready" and (not row.expires_on or row.expires_on >= today)
    }


def validate_filters(kbs, filters):
    schemas = {f["id"]: f for kb in kbs for f in field_schema(kb) if f["enabled"]}
    for item in filters:
        value = item.model_dump() if hasattr(item, "model_dump") else item
        if value["field"] not in schemas:
            raise ValueError(f"元数据字段不存在：{value['field']}")
        schema = schemas[value["field"]]
        if value["operator"] in {"gte", "lte"} and schema["type"] not in {"日期", "数字"}:
            raise ValueError("范围比较仅支持日期或数字字段")
        expected = metadata_value(value["value"], schema)
        if expected is None:
            raise ValueError("元数据过滤值不能为空")
        if value["operator"] == "contains" and schema["type"] in {"日期", "数字"}:
            raise ValueError("日期和数字字段请使用等于或范围比较")
    return schemas


def matches_metadata(values, filters, schemas):
    for item in filters:
        item = item.model_dump() if hasattr(item, "model_dump") else item
        actual = values.get(item["field"], {}).get("value")
        if actual in (None, "", []):
            return False
        expected = metadata_value(item["value"], schemas[item["field"]])
        operation = item["operator"]
        if operation == "eq":
            if isinstance(actual, list):
                required = expected if isinstance(expected, list) else [expected]
                if not all(value in actual for value in required):
                    return False
            elif actual != expected:
                return False
        if operation == "contains" and (str(item["value"]) not in str(actual)):
            return False
        if operation == "gte" and actual < expected:
            return False
        if operation == "lte" and actual > expected:
            return False
    return True
