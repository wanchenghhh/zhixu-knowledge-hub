from functools import lru_cache
from pathlib import Path
from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_prefix="HUB_")
    database_url: str = "sqlite:///./runtime/knowledge.db"
    data_dir: Path = Path("./runtime")
    encryption_key: str = ""
    environment: str = "development"
    queue_mode: str = "local"
    redis_url: str = "redis://localhost:6379/0"
    allow_local_models: bool = False
    max_file_bytes: int = 20 * 1024 * 1024
    max_pdf_pages: int = 200
    max_text_chars: int = 2_000_000
    frontend_dist: Path = Path("../frontend/dist")
    log_retention_days: int = 90
    lease_seconds: int = 900


@lru_cache
def settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    (s.data_dir / "files").mkdir(exist_ok=True, mode=0o700)
    if s.environment == "production" and (not s.encryption_key or s.database_url.startswith("sqlite")):
        raise RuntimeError("生产环境必须配置 HUB_ENCRYPTION_KEY 和 PostgreSQL")
    if not s.encryption_key:
        path = s.data_dir / ".encryption-key"
        if not path.exists():
            with path.open("xb") as handle:
                path.chmod(0o600)
                handle.write(Fernet.generate_key())
        s.encryption_key = path.read_text().strip()
    Fernet(s.encryption_key.encode())
    return s


def encrypt(secret: str) -> str:
    return Fernet(settings().encryption_key.encode()).encrypt(secret.encode()).decode()


def decrypt(secret: str | None) -> str:
    return Fernet(settings().encryption_key.encode()).decrypt(secret.encode()).decode() if secret else ""
