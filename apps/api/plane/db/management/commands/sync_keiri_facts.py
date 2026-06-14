# BARSOUL: F-4b keiri→Plane 同步. 见 docs/architecture/smart-table-mvp.md §10.
# keiri 订单事实(只读)同步进 issue_keiri_facts, 供 smart-table keiri_* deriver 读时投影.
# 范围 = 出现在 smart-table 行里的 issue(source_issue), 按需同步, 不全量刷 169 卡.
# 数据源: keiri /api/ledger(facts by order_id) + /api/orders/by-plane/{iid}(issue→order_id 链接).
# 容器内经 host.docker.internal:8099 访问 keiri. 绝不写 keiri SoR — 只读 + 写 Plane 侧投影表.
import json
import os
import urllib.request

from django.core.management.base import BaseCommand
from django.utils import timezone

from plane.db.models import Issue, IssueKeiriFacts, SmartRow

KEIRI_API = os.environ.get("KEIRI_API", "http://host.docker.internal:8099")


def _get(url, timeout=12):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


class Command(BaseCommand):
    help = "Sync keiri order facts into issue_keiri_facts for issues used in smart tables (F-4)."

    def handle(self, *args, **opts):
        issue_ids = list(
            SmartRow.objects.filter(source_issue__isnull=False)
            .values_list("source_issue_id", flat=True)
            .distinct()
        )
        if not issue_ids:
            self.stdout.write("no smart-table issue-linked rows; nothing to sync")
            return
        try:
            ledger = _get(f"{KEIRI_API}/api/ledger")
        except Exception as e:  # keiri unreachable → soft fail (投影是增强, 非核心)
            self.stderr.write(f"keiri ledger fetch failed: {e}")
            return
        omap = {int(o["id"]): o for o in ledger.get("orders", []) if o.get("id") is not None}
        mgr = getattr(IssueKeiriFacts, "all_objects", IssueKeiriFacts.objects)
        synced = 0
        for iss in Issue.objects.filter(id__in=issue_ids):
            try:
                ref = _get(f"{KEIRI_API}/api/orders/by-plane/{iss.id}")
            except Exception:
                continue  # 404 = 该卡无 keiri 订单; 跳过
            oid = ref.get("order_id") if isinstance(ref, dict) else None
            if oid is None and isinstance(ref, dict):
                oid = ref.get("id")
            o = omap.get(int(oid)) if oid is not None else None
            if not o:
                continue
            pays = o.get("payments") or []
            facts = dict(
                order_id=str(oid),
                customer=o.get("customer") or "",
                jpy=o.get("jpy"),
                cny=o.get("cny"),
                currency=o.get("currency") or "",
                freight=o.get("freight"),
                order_date=o.get("date") or "",
                items_count=len(o.get("items") or []),
                paid_amount=sum(float(p.get("amount") or 0) for p in pays),
                payment_count=len(pays),
                synced_at=timezone.now(),
            )
            obj = mgr.filter(issue=iss).first()
            if obj:
                for k, v in facts.items():
                    setattr(obj, k, v)
                obj.deleted_at = None
                obj.save()
            else:
                IssueKeiriFacts.objects.create(
                    issue=iss, project_id=iss.project_id, workspace_id=iss.workspace_id, **facts
                )
            synced += 1
        self.stdout.write(f"synced {synced} issue_keiri_facts from {len(issue_ids)} smart-table issue(s)")
