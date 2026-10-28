"""Add immutable Skill packages."""
from alembic import op
from app.db import Base
revision = "c4263e91"
down_revision = "b817cda3"
branch_labels = None
depends_on = None

def upgrade():
    Base.metadata.tables["skills"].create(op.get_bind(), checkfirst=True)

def downgrade():
    raise RuntimeError("Skill 包包含业务数据，请通过备份恢复")
