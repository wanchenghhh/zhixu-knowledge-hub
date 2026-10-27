"""Metadata, versioned indexes and published knowledge applications."""

from alembic import op
import sqlalchemy as sa
from app.db import Base

revision = "b817cda3"
down_revision = "927a664b697a"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        "knowledge_bases": [("processing_config", sa.JSON(), "{}")],
        "knowledge_files": [
            ("metadata_values", sa.JSON(), "{}"),
            ("preparation", sa.JSON(), "{}"),
            ("document_group", sa.String(36), ""),
            ("version_label", sa.String(100), ""),
            ("effective_on", sa.String(10), ""),
            ("expires_on", sa.String(10), ""),
            ("activated", sa.DateTime(), None),
            ("index_generation", sa.String(36), ""),
        ],
        "conversations": [
            ("application_id", sa.String(36), None),
            ("application_revision", sa.Integer(), None),
        ],
        "query_logs": [("application_id", sa.String(36), None)],
    }
    for table, fields in columns.items():
        existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
        for name, kind, default in fields:
            if name not in existing:
                op.add_column(table, sa.Column(name, kind, nullable=default is None, server_default=default))
    for table in ["knowledge_aux_indexes", "applications", "application_runs"]:
        Base.metadata.tables[table].create(op.get_bind(), checkfirst=True)
    op.execute("UPDATE knowledge_files SET document_group = id WHERE document_group = ''")
    op.execute(
        "UPDATE knowledge_files SET index_generation = (SELECT generation FROM knowledge_bases WHERE knowledge_bases.id = knowledge_files.kb_id) WHERE index_generation = ''"
    )
    op.execute(
        "UPDATE knowledge_files SET activated = updated WHERE status IN ('ready', 'disabled') AND activated IS NULL"
    )
    inspector = sa.inspect(op.get_bind())
    for table, name in [
        ("knowledge_files", "document_group"),
        ("conversations", "application_id"),
        ("query_logs", "application_id"),
    ]:
        index = f"ix_{table}_{name}"
        if index not in {i["name"] for i in inspector.get_indexes(table)}:
            op.create_index(index, table, [name])


def downgrade():
    raise RuntimeError("v1.2 包含业务数据，请通过备份恢复，避免静默删除应用和元数据")
