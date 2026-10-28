"""Persist manually collected evaluation datasets and cases."""

from alembic import op
from app.db import Base

revision = "d682941a"
down_revision = "c4263e91"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("evaluation_datasets", "evaluation_cases"):
        Base.metadata.tables[table].create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError("评测集包含业务数据，请通过备份恢复")
