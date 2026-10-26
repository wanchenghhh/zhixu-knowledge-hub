"""Private durable originals; local disk is only a cache in cloud deployments."""

import hashlib
import logging
from uuid import uuid4
from .config import settings

PART_BYTES = 2 * 1024 * 1024


def local_path(file_id):
    return settings().data_dir / "files" / file_id


def key(file_id):
    return f"knowledge-files/{file_id}"


def cloud():
    return settings().storage_backend == "vercel_blob"


def read_blob(pathname):
    from vercel.blob import sync as blob

    return blob.get_blob(pathname, access="private").body


def put_blob(pathname, data):
    from vercel.blob import sync as blob

    blob.put_blob(
        pathname,
        data,
        access="private",
        add_random_suffix=False,
        allow_overwrite=True,
        content_type="application/octet-stream",
    )


def persist(file_id, path):
    if cloud():
        put_blob(key(file_id), path.read_bytes())


def original_path(file):
    path = local_path(file.id)
    if not path.exists() and cloud():
        payload = read_blob(key(file.id))
        if len(payload) != file.size or hashlib.sha256(payload).hexdigest() != file.sha256:
            raise ValueError("原文件校验失败，请重新导入")
        temporary = path.with_suffix(f".download-{uuid4()}")
        temporary.write_bytes(payload)
        temporary.chmod(0o600)
        temporary.replace(path)
    return path


def put_part(file_id, index, payload):
    if cloud():
        put_blob(f"{key(file_id)}/parts/{index}", payload)
    else:
        path = local_path(f"{file_id}.part.{index}")
        path.write_bytes(payload)
        path.chmod(0o600)


def finish_parts(file):
    manifest = file.cloud_jobs["upload"]
    count = manifest["count"]
    if len(manifest.get("received", {})) != count:
        raise ValueError("文件尚未上传完整，请重新上传")
    path = local_path(file.id)
    digest, size = hashlib.sha256(), 0
    with path.open("wb") as handle:
        path.chmod(0o600)
        for index in range(count):
            payload = (
                read_blob(f"{key(file.id)}/parts/{index}")
                if cloud()
                else local_path(f"{file.id}.part.{index}").read_bytes()
            )
            if hashlib.sha256(payload).hexdigest() != manifest["received"][str(index)]:
                raise ValueError("上传分片校验失败，请重新上传")
            size += len(payload)
            if size > settings().max_file_bytes:
                raise ValueError("文件超过上传限制")
            digest.update(payload)
            handle.write(payload)
    if size != file.size or digest.hexdigest() != file.sha256:
        path.unlink(missing_ok=True)
        raise ValueError("文件大小或校验值不匹配，请重新上传")
    persist(file.id, path)
    return path


def cleanup_parts(file):
    count = file.cloud_jobs.get("upload", {}).get("count", 0)
    paths = [f"{key(file.id)}/parts/{i}" for i in range(count)]
    if cloud() and paths:
        from vercel.blob import sync as blob

        try:
            blob.delete_blob(paths)
        except Exception as exc:
            logging.getLogger(__name__).warning("Temporary upload cleanup failed (%s)", type(exc).__name__)
    if not cloud():
        for index in range(count):
            local_path(f"{file.id}.part.{index}").unlink(missing_ok=True)


def remove(file):
    cleanup_parts(file)
    if cloud():
        from vercel.blob import sync as blob

        try:
            blob.delete_blob(key(file.id))
        except blob.BlobNotFoundError:
            pass
    local_path(file.id).unlink(missing_ok=True)
