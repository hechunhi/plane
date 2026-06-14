# BARSOUL: Blueprint B-1 — 从 stdin 导入并发布一份蓝图定义 JSON(B-0 种子 / 升版).
# 用法: docker exec -i plane-api-1 python manage.py import_blueprint --project <uuid> < blueprint.json
import json
import sys

from django.core.management.base import BaseCommand
from django.utils import timezone

from plane.db.models import Blueprint, BlueprintVersion, Project


class Command(BaseCommand):
    help = "Import & publish a blueprint definition JSON from stdin (idempotent per version)."

    def add_arguments(self, parser):
        parser.add_argument("--project", required=True, help="home project uuid")

    def handle(self, *args, **opts):
        defn = json.load(sys.stdin)
        slug_name = (defn.get("blueprint") or "").strip()
        ver = int(defn.get("version") or 1)
        if not slug_name:
            self.stderr.write("definition missing 'blueprint' slug")
            return
        p = Project.objects.get(pk=opts["project"])
        b, created = Blueprint.objects.get_or_create(
            project_id=p.id, workspace_id=p.workspace_id, name=slug_name,
            defaults={
                "description": defn.get("title") or slug_name,
                "scope": "project",
                "permission": defn.get("permission") or {},
            },
        )
        if BlueprintVersion.objects.filter(blueprint=b, version=ver).exists():
            self.stdout.write(f"{slug_name} v{ver} already imported; skip")
            return
        BlueprintVersion.objects.create(
            blueprint=b, version=ver, definition=defn,
            changelog="imported via import_blueprint", published_at=timezone.now(),
            project_id=p.id, workspace_id=p.workspace_id)
        self.stdout.write(f"imported {slug_name} v{ver} -> {p.name} (blueprint {'created' if created else 'existing'})")
