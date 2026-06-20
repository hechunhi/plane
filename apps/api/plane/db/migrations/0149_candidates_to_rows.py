from django.db import migrations


def candidates_to_rows(apps, schema_editor):
    SmartRow = apps.get_model("db", "SmartRow")
    SmartTableIssueBinding = apps.get_model("db", "SmartTableIssueBinding")
    for b in SmartTableIssueBinding.objects.filter(row__isnull=False, deleted_at__isnull=True):
        row = b.row
        if row.deleted_at is not None:
            continue
        meta = row.meta or {}
        cands = meta.get("candidates") or []
        if not cands:
            continue
        for cand in cands:
            values = cand.get("values") or {}
            if not any(v not in (None, "", []) for v in values.values()):
                continue
            SmartRow.objects.create(
                table_id=row.table_id,
                source_issue_id=b.issue_id,
                cells=values,
                status="committed",
                position=0,
                meta={},
                project_id=row.project_id,
                workspace_id=row.workspace_id,
                created_by_id=row.created_by_id,
                updated_by_id=row.updated_by_id,
            )
        meta.pop("candidates", None)
        row.meta = meta
        row.save(update_fields=["meta"])


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0148_recurring_generation_prompt"),
    ]
    operations = [
        migrations.RunPython(candidates_to_rows, migrations.RunPython.noop),
    ]
