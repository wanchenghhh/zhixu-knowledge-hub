from pathlib import Path
from alembic.config import Config
from alembic import command
from sqlalchemy import inspect
from .db import engine


def upgrade_database():
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    tables = inspect(engine()).get_table_names()
    if "model_configs" in tables and "alembic_version" not in tables:
        command.stamp(config, "927a664b697a")
    command.upgrade(config, "head")


if __name__ == "__main__":
    upgrade_database()
