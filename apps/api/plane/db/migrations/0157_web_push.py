# BARSOUL 2026-08: Web Push(PWA のプッシュ通知)。端末ごとの購読先と、種類別の ON/OFF。
# 手書き移行(本リポ約定: deleted_at 必須)。書式は 0153_meeting_chat_actions に倣う。
import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def _audit():
    return [
        ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
        ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
        ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
        ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
    ]


def _actor(model_name):
    return [
        ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name=f"{model_name}_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
        ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name=f"{model_name}_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
    ]


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0156_draft_issue_done_at"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="WebPushSubscription",
            fields=_audit()
            + [
                ("endpoint", models.TextField(unique=True)),
                ("p256dh", models.TextField()),
                ("auth", models.TextField()),
                ("user_agent", models.TextField(blank=True, default="")),
                ("device_label", models.CharField(blank=True, default="", max_length=255)),
                ("is_standalone", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("failure_count", models.PositiveIntegerField(default=0)),
                ("last_used_at", models.DateTimeField(blank=True, null=True)),
            ]
            + _actor("webpushsubscription")
            + [
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="web_push_subscriptions", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Web Push Subscription",
                "verbose_name_plural": "Web Push Subscriptions",
                "db_table": "web_push_subscriptions",
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddIndex(
            model_name="webpushsubscription",
            index=models.Index(fields=["user", "is_active"], name="wps_user_active_idx"),
        ),
        migrations.CreateModel(
            name="WebPushPreference",
            fields=_audit()
            + [
                ("mention", models.BooleanField(default=True)),
                ("comment_reply", models.BooleanField(default=True)),
                ("assigned", models.BooleanField(default=True)),
                ("deadline", models.BooleanField(default=True)),
                ("important_update", models.BooleanField(default=True)),
            ]
            + _actor("webpushpreference")
            + [
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="web_push_preference", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Web Push Preference",
                "verbose_name_plural": "Web Push Preferences",
                "db_table": "web_push_preferences",
            },
        ),
    ]
