from pathlib import Path
from alembic.config import Config
from alembic import command

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(config, "head")
