"""Immutable, bounded Agent Skills packages with inert supporting resources."""
import base64
import hashlib
import io
import re
import stat
import zipfile
from pathlib import PurePosixPath
from uuid import uuid4

import yaml
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from .db import Skill, session_factory
from .security import managed, role_header

router = APIRouter(prefix="/api/v1")
MAX_ARCHIVE = 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024
MAX_FILES = 60
MAX_FILE = 256 * 1024


def database():
    with session_factory()() as db:
        yield db


def parse_package(filename, data):
    if len(data) > MAX_ARCHIVE:
        raise ValueError("Skill 上传文件不能超过 1 MB")
    files = {}
    if filename.lower().endswith('.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = [i for i in archive.infolist() if not i.is_dir() and not i.filename.startswith('__MACOSX/')]
                if not entries or len(entries) > MAX_FILES or sum(i.file_size for i in entries) > MAX_TOTAL:
                    raise ValueError("Skill 包文件数量或解压大小超出限制")
                for entry in entries:
                    path = PurePosixPath(entry.filename)
                    if ('\\' in entry.filename or path.is_absolute() or '..' in path.parts or
                        any(p.startswith('.') for p in path.parts) or stat.S_ISLNK(entry.external_attr >> 16) or
                        entry.file_size > MAX_FILE or entry.flag_bits & 1):
                        raise ValueError("Skill 包包含不安全路径、链接、加密文件或超大文件")
                    if entry.filename in files:
                        raise ValueError("Skill 包中存在重复文件路径")
                    files[entry.filename] = archive.read(entry)
        except (zipfile.BadZipFile, RuntimeError):
            raise ValueError("无法读取 Skill ZIP 文件") from None
    elif filename == 'SKILL.md':
        files['SKILL.md'] = data
    else:
        raise ValueError("请上传 SKILL.md 或包含它的 ZIP 包")
    roots = [path for path in files if PurePosixPath(path).name == 'SKILL.md']
    if len(roots) != 1:
        raise ValueError("Skill 包必须且只能包含一个 SKILL.md")
    root = str(PurePosixPath(roots[0]).parent)
    prefix = '' if root == '.' else root + '/'
    if any(not p.startswith(prefix) for p in files):
        raise ValueError("所有文件须位于 SKILL.md 所在目录内")
    files = {p[len(prefix):]: content for p, content in files.items()}
    try:
        text = files['SKILL.md'].decode('utf-8-sig')
    except UnicodeDecodeError:
        raise ValueError("SKILL.md 必须使用 UTF-8 编码") from None
    if len(text) > 20000:
        raise ValueError("SKILL.md 指令正文不能超过 20000 字符，请将资料放入配套文件")
    match = re.match(r'^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$', text)
    if not match:
        raise ValueError("SKILL.md 须包含 YAML frontmatter 与正文")
    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        raise ValueError("SKILL.md 的 YAML 格式不正确") from None
    if not isinstance(meta, dict):
        raise ValueError("Skill 元数据必须是 YAML 对象")
    name, description = meta.get('name'), meta.get('description')
    if not isinstance(name, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name) or len(name) > 64:
        raise ValueError("Skill name 须为 1–64 位小写字母、数字或单连字符")
    if prefix and PurePosixPath(root).name != name:
        raise ValueError("Skill 目录名须与 frontmatter 中的 name 一致")
    if not isinstance(description, str) or not description.strip() or len(description) > 1024:
        raise ValueError("Skill description 须为 1–1024 字符")
    if not match.group(2).strip():
        raise ValueError("SKILL.md 指令正文不能为空")
    return name, description.strip(), {p: base64.b64encode(v).decode('ascii') for p, v in files.items()}


def skill_dict(skill):
    return {"id": skill.id, "name": skill.name, "description": skill.description,
            "sha256": skill.sha256, "files": sorted(skill.files), "created": skill.created.isoformat()}


@router.get('/skills')
def list_skills(db=Depends(database), role=Depends(role_header)):
    managed(role)
    return [skill_dict(s) for s in db.scalars(select(Skill).order_by(Skill.created.desc()))]


@router.post('/skills')
async def upload_skill(file: UploadFile = File(...), db=Depends(database), role=Depends(role_header)):
    managed(role)
    data = await file.read(MAX_ARCHIVE + 1)
    try:
        name, description, files = parse_package(file.filename or '', data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    digest = hashlib.sha256(data).hexdigest()
    existing = db.scalar(select(Skill).where(Skill.sha256 == digest))
    if existing:
        return skill_dict(existing)
    skill = Skill(id=str(uuid4()), name=name, description=description, files=files, sha256=digest)
    db.add(skill)
    db.commit()
    return skill_dict(skill)
