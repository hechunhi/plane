# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python import
from uuid import uuid4

# Django imports
from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction, connection
from django.utils import timezone
from django.db.models import Q
from django import apps

# Module imports
from plane.utils.html_processor import strip_tags
from plane.db.mixins import SoftDeletionManager
from plane.utils.exception_logger import log_exception
from .project import ProjectBaseModel
from .base import BaseModel
from plane.utils.uuid import convert_uuid_to_integer
from .description import Description
from plane.db.mixins import ChangeTrackerMixin
from .state import StateGroup


def get_default_properties():
    return {
        "assignee": True,
        "start_date": True,
        "due_date": True,
        "labels": True,
        "key": True,
        "priority": True,
        "state": True,
        "sub_issue_count": True,
        "link": True,
        "attachment_count": True,
        "estimate": True,
        "created_on": True,
        "updated_on": True,
    }


def get_default_filters():
    return {
        "priority": None,
        "state": None,
        "state_group": None,
        "assignees": None,
        "created_by": None,
        "labels": None,
        "start_date": None,
        "target_date": None,
        "subscriber": None,
    }


def get_default_display_filters():
    return {
        "group_by": None,
        "order_by": "-created_at",
        "type": None,
        # BARSOUL B-2k→B-2m(2026-06-10): 曾默认收起子工作项(防站卡平铺迷失),
        # 用户实测后否决「完全看不见也不行」→ 回滚为显示;迷失问题改由
        # 看板卡上的**所属流程面包屑**(↳ 父卡名)解决 — 看得见 + 知归属。
        "sub_issue": True,
        "show_empty_groups": True,
        "layout": "list",
        "calendar_date_range": "",
    }


def get_default_display_properties():
    return {
        "assignee": True,
        "attachment_count": True,
        "created_on": True,
        "due_date": True,
        "estimate": True,
        "key": True,
        "labels": True,
        "link": True,
        "priority": True,
        "start_date": True,
        "state": True,
        "sub_issue_count": True,
        "updated_on": True,
    }


# TODO: Handle identifiers for Bulk Inserts - nk
class IssueManager(SoftDeletionManager):
    def get_queryset(self):
        from django.utils import timezone as _tz

        return (
            super()
            .get_queryset()
            .exclude(state__group=StateGroup.TRIAGE.value)
            .exclude(archived_at__isnull=False)
            .exclude(project__archived_at__isnull=False)
            .exclude(is_draft=True)
            # BARSOUL スヌーズ: 未来 snooze 中のカードを active 视图から隠す(过期は条件 false→自动复活;
            # null は __gt が NULL→not true→残る, 全存量卡不受影响)。详情は .objects なので隠れても開ける。
            .exclude(snoozed_until__gt=_tz.now())
        )


class Issue(ProjectBaseModel):
    PRIORITY_CHOICES = (
        ("urgent", "Urgent"),
        ("high", "High"),
        ("medium", "Medium"),
        ("low", "Low"),
        ("none", "None"),
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="parent_issue",
    )
    state = models.ForeignKey(
        "db.State",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="state_issue",
    )
    point = models.IntegerField(validators=[MinValueValidator(0), MaxValueValidator(12)], null=True, blank=True)
    estimate_point = models.ForeignKey(
        "db.EstimatePoint",
        on_delete=models.SET_NULL,
        related_name="issue_estimates",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255, verbose_name="Issue Name")
    description_json = models.JSONField(blank=True, default=dict)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    description_binary = models.BinaryField(null=True)
    priority = models.CharField(
        max_length=30,
        choices=PRIORITY_CHOICES,
        verbose_name="Issue Priority",
        default="none",
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    assignees = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="assignee",
        through="IssueAssignee",
        through_fields=("issue", "assignee"),
    )
    sequence_id = models.IntegerField(default=1, verbose_name="Issue Sequence ID")
    labels = models.ManyToManyField("db.Label", blank=True, related_name="labels", through="IssueLabel")
    sort_order = models.FloatField(default=65535)
    completed_at = models.DateTimeField(null=True)
    archived_at = models.DateField(null=True)
    is_draft = models.BooleanField(default=False)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    type = models.ForeignKey(
        "db.IssueType",
        on_delete=models.SET_NULL,
        related_name="issue_type",
        null=True,
        blank=True,
    )
    # BARSOUL フォローアップ・スヌーズ(Linear 风): snoozed_until > now のカードは issue_objects から隠れる
    # (active 视图全过滤)→ 期日に自动复活(过滤翻转)+ Beat が 1 回ベル(snoozed_by へ, 零评论)。
    # nullable → null 时与现状完全一致(全存量卡不受影响)。详情 retrieve は .objects 使用なので隠れても直链で開ける。
    snoozed_until = models.DateTimeField(null=True, blank=True)  # 隐藏驱动(remind_hide 时 = remind_at;否则 null)
    snoozed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="snoozed_issues"
    )
    # BARSOUL 2026-06-15 リマインダー強化(hechun: 旧スヌーズ"做的不好"): 可配置提醒。
    # remind_at = 触发时刻(权威, 高频 Beat 扫描); 隐藏与否分离 → remind_hide=False 时卡留视图+徽章(治"黑洞")。
    remind_at = models.DateTimeField(null=True, blank=True, db_index=True)
    remind_hide = models.BooleanField(default=False)              # 是否到点前隐藏卡片(默认否)
    remind_intensity = models.CharField(max_length=8, default="once")    # once=1回铃 / daily=每日续提醒至完成
    remind_audience = models.CharField(max_length=12, default="self")    # self / assignees / members
    remind_note = models.CharField(max_length=200, blank=True, default="")  # 备忘: 到时提醒我做什么(显示在铃/hub/卡顶条)
    remind_fired_on = models.DateField(null=True, blank=True)     # daily 去重: 最近响铃的 JST 日

    issue_objects = IssueManager()

    class Meta:
        verbose_name = "Issue"
        verbose_name_plural = "Issues"
        db_table = "issues"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        if self.state is None:
            try:
                from plane.db.models import State

                default_state = State.objects.filter(
                    ~models.Q(is_triage=True), project=self.project, default=True
                ).first()
                if default_state is None:
                    random_state = State.objects.filter(~models.Q(is_triage=True), project=self.project).first()
                    self.state = random_state
                else:
                    self.state = default_state
            except ImportError:
                pass
        else:
            try:
                from plane.db.models import State

                if self.state.group == "completed":
                    self.completed_at = timezone.now()
                else:
                    self.completed_at = None
            except ImportError:
                pass

        if self._state.adding:
            with transaction.atomic():
                # Create a lock for this specific project using a transaction-level advisory lock
                # This ensures only one transaction per project can execute this code at a time
                # The lock is automatically released when the transaction ends
                lock_key = convert_uuid_to_integer(self.project.id)

                with connection.cursor() as cursor:
                    # Get an exclusive transaction-level lock using the project ID as the lock key
                    cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_key])

                # Get the last sequence for the project
                last_sequence = IssueSequence.objects.filter(project=self.project).aggregate(
                    largest=models.Max("sequence")
                )["largest"]
                self.sequence_id = last_sequence + 1 if last_sequence else 1
                # Strip the html tags using html parser
                self.description_stripped = (
                    None
                    if (self.description_html == "" or self.description_html is None)
                    else strip_tags(self.description_html)
                )
                largest_sort_order = Issue.objects.filter(project=self.project, state=self.state).aggregate(
                    largest=models.Max("sort_order")
                )["largest"]
                if largest_sort_order is not None:
                    self.sort_order = largest_sort_order + 10000

                super(Issue, self).save(*args, **kwargs)

                IssueSequence.objects.create(issue=self, sequence=self.sequence_id, project=self.project)
        else:
            # Strip the html tags using html parser
            self.description_stripped = (
                None
                if (self.description_html == "" or self.description_html is None)
                else strip_tags(self.description_html)
            )
            super(Issue, self).save(*args, **kwargs)

    def __str__(self):
        """Return name of the issue"""
        return f"{self.name} <{self.project.name}>"


class IssueBlocker(ProjectBaseModel):
    block = models.ForeignKey(Issue, related_name="blocker_issues", on_delete=models.CASCADE)
    blocked_by = models.ForeignKey(Issue, related_name="blocked_issues", on_delete=models.CASCADE)

    class Meta:
        verbose_name = "Issue Blocker"
        verbose_name_plural = "Issue Blockers"
        db_table = "issue_blockers"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.block.name} {self.blocked_by.name}"


class IssueRelationChoices(models.TextChoices):
    DUPLICATE = "duplicate", "Duplicate"
    RELATES_TO = "relates_to", "Relates To"
    BLOCKED_BY = "blocked_by", "Blocked By"
    START_BEFORE = "start_before", "Start Before"
    FINISH_BEFORE = "finish_before", "Finish Before"
    IMPLEMENTED_BY = "implemented_by", "Implemented By"


# Bidirectional relation pairs: (forward, reverse)
# Defined after class to avoid enum metaclass conflicts
IssueRelationChoices._RELATION_PAIRS = (
    ("blocked_by", "blocking"),
    ("relates_to", "relates_to"),  # symmetric
    ("duplicate", "duplicate"),  # symmetric
    ("start_before", "start_after"),
    ("finish_before", "finish_after"),
    ("implemented_by", "implements"),
)

# Generate reverse mapping from pairs
IssueRelationChoices._REVERSE_MAPPING = {forward: reverse for forward, reverse in IssueRelationChoices._RELATION_PAIRS}


class IssueRelation(ProjectBaseModel):
    issue = models.ForeignKey(Issue, related_name="issue_relation", on_delete=models.CASCADE)
    related_issue = models.ForeignKey(Issue, related_name="issue_related", on_delete=models.CASCADE)
    relation_type = models.CharField(
        max_length=20,
        verbose_name="Issue Relation Type",
        default=IssueRelationChoices.BLOCKED_BY,
    )

    class Meta:
        unique_together = ["issue", "related_issue", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "related_issue"],
                condition=Q(deleted_at__isnull=True),
                name="issue_relation_unique_issue_related_issue_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Relation"
        verbose_name_plural = "Issue Relations"
        db_table = "issue_relations"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.related_issue.name}"


class IssueMention(ProjectBaseModel):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_mention")
    mention = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="issue_mention")

    class Meta:
        unique_together = ["issue", "mention", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "mention"],
                condition=Q(deleted_at__isnull=True),
                name="issue_mention_unique_issue_mention_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Mention"
        verbose_name_plural = "Issue Mentions"
        db_table = "issue_mentions"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.mention.email}"


class IssueAssignee(ProjectBaseModel):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_assignee")
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_assignee",
    )

    class Meta:
        unique_together = ["issue", "assignee", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "assignee"],
                condition=Q(deleted_at__isnull=True),
                name="issue_assignee_unique_issue_assignee_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Assignee"
        verbose_name_plural = "Issue Assignees"
        db_table = "issue_assignees"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.assignee.email}"


class IssueLink(ProjectBaseModel):
    title = models.CharField(max_length=255, null=True, blank=True)
    url = models.TextField()
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_link")
    metadata = models.JSONField(default=dict)

    class Meta:
        verbose_name = "Issue Link"
        verbose_name_plural = "Issue Links"
        db_table = "issue_links"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.url}"


def get_upload_path(instance, filename):
    return f"{instance.workspace.id}/{uuid4().hex}-{filename}"


def file_size(value):
    # File limit check is only for cloud hosted
    if value.size > settings.FILE_SIZE_LIMIT:
        raise ValidationError("File too large. Size should not exceed 5 MB.")


class IssueAttachment(ProjectBaseModel):
    attributes = models.JSONField(default=dict)
    asset = models.FileField(upload_to=get_upload_path, validators=[file_size])
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_attachment")
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        verbose_name = "Issue Attachment"
        verbose_name_plural = "Issue Attachments"
        db_table = "issue_attachments"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.asset}"


class IssueActivity(ProjectBaseModel):
    issue = models.ForeignKey(Issue, on_delete=models.DO_NOTHING, null=True, related_name="issue_activity")
    verb = models.CharField(max_length=255, verbose_name="Action", default="created")
    field = models.CharField(max_length=255, verbose_name="Field Name", blank=True, null=True)
    old_value = models.TextField(verbose_name="Old Value", blank=True, null=True)
    new_value = models.TextField(verbose_name="New Value", blank=True, null=True)

    comment = models.TextField(verbose_name="Comment", blank=True)
    attachments = ArrayField(models.URLField(), size=10, blank=True, default=list)
    issue_comment = models.ForeignKey(
        "db.IssueComment",
        on_delete=models.DO_NOTHING,
        related_name="issue_comment",
        null=True,
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="issue_activities",
    )
    old_identifier = models.UUIDField(null=True)
    new_identifier = models.UUIDField(null=True)
    epoch = models.FloatField(null=True)

    class Meta:
        verbose_name = "Issue Activity"
        verbose_name_plural = "Issue Activities"
        db_table = "issue_activities"
        ordering = ("-created_at",)

    def __str__(self):
        """Return issue of the comment"""
        return str(self.issue)


class IssueComment(ChangeTrackerMixin, ProjectBaseModel):
    comment_stripped = models.TextField(verbose_name="Comment", blank=True)
    comment_json = models.JSONField(blank=True, default=dict)
    comment_html = models.TextField(blank=True, default="<p></p>")
    description = models.OneToOneField(
        "db.Description", on_delete=models.CASCADE, related_name="issue_comment_description", null=True
    )
    attachments = ArrayField(models.URLField(), size=10, blank=True, default=list)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_comments")
    # System can also create comment
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comments",
        null=True,
    )
    access = models.CharField(
        choices=(("INTERNAL", "INTERNAL"), ("EXTERNAL", "EXTERNAL")),
        default="INTERNAL",
        max_length=100,
    )
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="parent_issue_comment"
    )

    TRACKED_FIELDS = ["comment_stripped", "comment_json", "comment_html"]

    def save(self, *args, **kwargs):
        """
        Custom save method for IssueComment that manages the associated Description model.

        This method handles creation and updates of both the comment and its description in a
        single atomic transaction to ensure data consistency.
        """

        self.comment_stripped = strip_tags(self.comment_html) if self.comment_html != "" else ""
        is_creating = self._state.adding

        # Prepare description defaults
        description_defaults = {
            "workspace_id": self.workspace_id,
            "project_id": self.project_id,
            "created_by_id": self.created_by_id,
            "updated_by_id": self.updated_by_id,
            "description_stripped": self.comment_stripped,
            "description_json": self.comment_json,
            "description_html": self.comment_html,
        }

        with transaction.atomic():
            super(IssueComment, self).save(*args, **kwargs)

            if is_creating or not self.description_id:
                # Create new description for new comment
                description = Description.objects.create(**description_defaults)
                self.description_id = description.id
                super(IssueComment, self).save(update_fields=["description_id"])
            else:
                field_mapping = {
                    "comment_html": "description_html",
                    "comment_stripped": "description_stripped",
                    "comment_json": "description_json",
                }

                # Use _changes_on_save which is captured by ChangeTrackerMixin.save()
                # before the tracked fields are reset
                changed_fields = {
                    desc_field: getattr(self, comment_field)
                    for comment_field, desc_field in field_mapping.items()
                    if comment_field in self._changes_on_save
                }

                # Update description only if comment fields changed
                if changed_fields and self.description_id:
                    Description.objects.filter(pk=self.description_id).update(
                        **changed_fields, updated_by_id=self.updated_by_id, updated_at=self.updated_at
                    )

    class Meta:
        verbose_name = "Issue Comment"
        verbose_name_plural = "Issue Comments"
        db_table = "issue_comments"
        ordering = ("-created_at",)

    def __str__(self):
        """Return issue of the comment"""
        return str(self.issue)


class IssueLabel(ProjectBaseModel):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="label_issue")
    label = models.ForeignKey("db.Label", on_delete=models.CASCADE, related_name="label_issue")

    class Meta:
        verbose_name = "Issue Label"
        verbose_name_plural = "Issue Labels"
        db_table = "issue_labels"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.label.name}"


class IssueSequence(ProjectBaseModel):
    issue = models.ForeignKey(
        Issue,
        on_delete=models.SET_NULL,
        related_name="issue_sequence",
        null=True,  # This is set to null because we want to keep the sequence even if the issue is deleted
    )
    sequence = models.PositiveBigIntegerField(default=1, db_index=True)
    deleted = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Issue Sequence"
        verbose_name_plural = "Issue Sequences"
        db_table = "issue_sequences"
        ordering = ("-created_at",)


class IssueSubscriber(ProjectBaseModel):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_subscribers")
    subscriber = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_subscribers",
    )

    class Meta:
        unique_together = ["issue", "subscriber", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "subscriber"],
                condition=models.Q(deleted_at__isnull=True),
                name="issue_subscriber_unique_issue_subscriber_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Subscriber"
        verbose_name_plural = "Issue Subscribers"
        db_table = "issue_subscribers"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.subscriber.email}"


class IssueReaction(ProjectBaseModel):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_reactions",
    )
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="issue_reactions")
    reaction = models.TextField()

    class Meta:
        unique_together = ["issue", "actor", "reaction", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "actor", "reaction"],
                condition=models.Q(deleted_at__isnull=True),
                name="issue_reaction_unique_issue_actor_reaction_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Reaction"
        verbose_name_plural = "Issue Reactions"
        db_table = "issue_reactions"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.actor.email}"


class CommentReaction(ProjectBaseModel):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comment_reactions",
    )
    comment = models.ForeignKey(IssueComment, on_delete=models.CASCADE, related_name="comment_reactions")
    reaction = models.TextField()

    class Meta:
        unique_together = ["comment", "actor", "reaction", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["comment", "actor", "reaction"],
                condition=models.Q(deleted_at__isnull=True),
                name="comment_reaction_unique_comment_actor_reaction_when_deleted_at_null",
            )
        ]
        verbose_name = "Comment Reaction"
        verbose_name_plural = "Comment Reactions"
        db_table = "comment_reactions"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.actor.email}"


class IssueVote(ProjectBaseModel):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="votes")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="votes")
    vote = models.IntegerField(choices=((-1, "DOWNVOTE"), (1, "UPVOTE")), default=1)

    class Meta:
        unique_together = ["issue", "actor", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "actor"],
                condition=models.Q(deleted_at__isnull=True),
                name="issue_vote_unique_issue_actor_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Vote"
        verbose_name_plural = "Issue Votes"
        db_table = "issue_votes"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue.name} {self.actor.email}"


class IssueVersion(ProjectBaseModel):
    PRIORITY_CHOICES = (
        ("urgent", "Urgent"),
        ("high", "High"),
        ("medium", "Medium"),
        ("low", "Low"),
        ("none", "None"),
    )

    parent = models.UUIDField(blank=True, null=True)
    state = models.UUIDField(blank=True, null=True)
    estimate_point = models.UUIDField(blank=True, null=True)
    name = models.CharField(max_length=255, verbose_name="Issue Name")
    priority = models.CharField(
        max_length=30,
        choices=PRIORITY_CHOICES,
        verbose_name="Issue Priority",
        default="none",
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    assignees = ArrayField(models.UUIDField(), blank=True, default=list)
    sequence_id = models.IntegerField(default=1, verbose_name="Issue Sequence ID")
    labels = ArrayField(models.UUIDField(), blank=True, default=list)
    sort_order = models.FloatField(default=65535)
    completed_at = models.DateTimeField(null=True)
    archived_at = models.DateField(null=True)
    is_draft = models.BooleanField(default=False)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    type = models.UUIDField(blank=True, null=True)
    cycle = models.UUIDField(null=True, blank=True)
    modules = ArrayField(models.UUIDField(), blank=True, default=list)
    properties = models.JSONField(default=dict)  # issue properties
    meta = models.JSONField(default=dict)  # issue meta
    last_saved_at = models.DateTimeField(default=timezone.now)

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="versions")
    activity = models.ForeignKey(
        "db.IssueActivity",
        on_delete=models.SET_NULL,
        null=True,
        related_name="versions",
    )
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_versions",
    )

    class Meta:
        verbose_name = "Issue Version"
        verbose_name_plural = "Issue Versions"
        db_table = "issue_versions"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.name} <{self.project.name}>"

    @classmethod
    def log_issue_version(cls, issue, user):
        try:
            """
            Log the issue version
            """

            Module = apps.get_model("db.Module")
            CycleIssue = apps.get_model("db.CycleIssue")
            IssueAssignee = apps.get_model("db.IssueAssignee")
            IssueLabel = apps.get_model("db.IssueLabel")

            cycle_issue = CycleIssue.objects.filter(issue=issue).first()

            cls.objects.create(
                issue=issue,
                parent=issue.parent_id,
                state=issue.state_id,
                estimate_point=issue.estimate_point_id,
                name=issue.name,
                priority=issue.priority,
                start_date=issue.start_date,
                target_date=issue.target_date,
                assignees=list(IssueAssignee.objects.filter(issue=issue).values_list("assignee_id", flat=True)),
                sequence_id=issue.sequence_id,
                labels=list(IssueLabel.objects.filter(issue=issue).values_list("label_id", flat=True)),
                sort_order=issue.sort_order,
                completed_at=issue.completed_at,
                archived_at=issue.archived_at,
                is_draft=issue.is_draft,
                external_source=issue.external_source,
                external_id=issue.external_id,
                type=issue.type_id,
                cycle=cycle_issue.cycle_id if cycle_issue else None,
                modules=list(Module.objects.filter(issue=issue).values_list("id", flat=True)),
                properties={},
                meta={},
                last_saved_at=timezone.now(),
                owned_by=user,
            )
            return True
        except Exception as e:
            log_exception(e)
            return False


class IssueDescriptionVersion(ProjectBaseModel):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="description_versions")
    description_binary = models.BinaryField(null=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    description_json = models.JSONField(default=dict, blank=True)
    last_saved_at = models.DateTimeField(default=timezone.now)
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_description_versions",
    )

    class Meta:
        verbose_name = "Issue Description Version"
        verbose_name_plural = "Issue Description Versions"
        db_table = "issue_description_versions"

    @classmethod
    def log_issue_description_version(cls, issue, user):
        try:
            """
            Log the issue description version
            """
            cls.objects.create(
                workspace_id=issue.workspace_id,
                project_id=issue.project_id,
                created_by_id=issue.created_by_id,
                updated_by_id=issue.updated_by_id,
                owned_by_id=user,
                last_saved_at=timezone.now(),
                issue_id=issue.id,
                description_binary=issue.description_binary,
                description_html=issue.description_html,
                description_stripped=issue.description_stripped,
                description_json=issue.description_json,
            )
            return True
        except Exception as e:
            log_exception(e)
            return False


# BARSOUL: 评论翻译派生层 (愛ちゃん 自动翻译 内嵌化, 替代原"独立评论"路径)
# 真相=原 IssueComment, 派生=本表(可重译/可删, 不污染主轨)。每条评论 × 目标
# 语言唯一。upsert by (comment, target_lang)。前端折叠渲染 + 用户开关自动展开。
class CommentTranslation(ProjectBaseModel):
    comment = models.ForeignKey(
        IssueComment, on_delete=models.CASCADE,
        related_name="translations")
    target_lang = models.CharField(max_length=8)   # e.g. "ja","zh","en"
    source_lang = models.CharField(max_length=8, blank=True, default="")
    text = models.TextField(blank=True, default="")
    translated_by = models.CharField(max_length=64, blank=True, default="aichan")
    # BARSOUL 2026-05-31 (hechun): 内容ハッシュキャッシュ。frontend は常に
    # tokenized(⟦N⟧) masked text を送る→旧 override 経路は cache を読み書きせず
    # ページ開く度に再翻訳していた(ユーザ指摘)。masked text の sha256 を保存し、
    # 同 hash なら DB hit(~5ms)即返。comment 編集→hash 変化→自然 miss 再翻訳
    # (self-invalidating, edit イベント hook 不要)。
    source_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)

    class Meta:
        verbose_name = "Comment Translation"
        verbose_name_plural = "Comment Translations"
        db_table = "comment_translations"
        constraints = [
            models.UniqueConstraint(
                fields=["comment", "target_lang"],
                name="uniq_comment_translation_per_lang"),
        ]
        indexes = [
            models.Index(fields=["comment", "target_lang"]),
        ]

    def __str__(self):
        return f"{self.comment_id}:{self.target_lang}"


class IssueTranslation(ProjectBaseModel):
    """BARSOUL 2026-06-15 (hechun): issue 标题/正文の表示翻訳キャッシュ。評論翻訳
    (CommentTranslation)と同型 — **原 issue.name / description_html は不可変(真相)**,
    本表は読み取り専用の派生キャッシュ(target_lang 別 + source_hash 自己無効化)。
    field で title(纯文本)/ description(富 HTML)を区別。表示のみ, 内容改変なし。"""
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="translations")
    field = models.CharField(max_length=16)          # "title" | "description"
    target_lang = models.CharField(max_length=8)     # "ja" | "zh" | "en"
    source_lang = models.CharField(max_length=8, blank=True, default="")
    text = models.TextField(blank=True, default="")
    translated_by = models.CharField(max_length=64, blank=True, default="aichan")
    source_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)

    class Meta:
        verbose_name = "Issue Translation"
        verbose_name_plural = "Issue Translations"
        db_table = "issue_translations"
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "field", "target_lang"],
                name="uniq_issue_translation_per_field_lang"),
        ]
        indexes = [
            models.Index(fields=["issue", "field", "target_lang"]),
        ]

    def __str__(self):
        return f"{self.issue_id}:{self.field}:{self.target_lang}"


# BARSOUL: 派生卡片当前态 (Derived Issue State, DIS)。真相=issue + comments +
# activity,派生=本表(可重算/可删,**绝不污染主轨**)。每 issue 唯一一行
# (OneToOne)。愛ちゃん/cloud Claude 从最近评论推断「球在谁手 / 下一步 / 是否
# 停滞」,看板卡顶静默渲染状态行。upsert by issue。详 docs/architecture/
# derived-issue-state-mvp.md。
class IssueAIState(ProjectBaseModel):
    issue = models.OneToOneField(
        Issue, on_delete=models.CASCADE, related_name="ai_state")
    # ACTIVE(推进中) | WAITING(等外部) | STALE(停滞) | UNKNOWN(信息不足)
    state = models.CharField(max_length=8, default="UNKNOWN")
    # SELF(球在我方) | OTHER(球在对方) | ""(未知)
    ball = models.CharField(max_length=8, blank=True, default="")
    current_actor = models.CharField(max_length=120, blank=True, default="")  # actor 显示名
    actor_kind = models.CharField(max_length=8, blank=True, default="")  # person|external|""
    actor_user_id = models.UUIDField(null=True, blank=True)  # person→Plane member(头像)
    owner = models.CharField(max_length=120, blank=True, default="")
    unassigned = models.BooleanField(default=False)  # ball=SELF 但无负责人
    # 等待对象(ball=OTHER), 双语
    waiting_on_zh = models.CharField(max_length=160, blank=True, default="")
    waiting_on_ja = models.CharField(max_length=160, blank=True, default="")
    # 下一步动作: 动词开头 ≤12 中文字, 双语(next_action=zh)
    next_action = models.CharField(max_length=160, blank=True, default="")
    next_action_ja = models.CharField(max_length=160, blank=True, default="")
    due_date = models.DateField(null=True, blank=True)
    stale_days = models.IntegerField(default=0)
    confidence = models.FloatField(default=0.0)  # 0~1
    reasoning = models.TextField(blank=True, default="")      # zh
    reasoning_ja = models.TextField(blank=True, default="")   # ja
    # 推断依据: 源评论作者 + 原文引用
    source_author = models.CharField(max_length=120, blank=True, default="")
    source_quote = models.CharField(max_length=400, blank=True, default="")
    model_used = models.CharField(max_length=40, blank=True, default="")
    # 输入指纹: 同 hash 跳过 LLM (去抖/省钱), self-invalidating
    source_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)
    schema_version = models.PositiveSmallIntegerField(default=1)
    # 人手补充说明(双语,喂给 AI 重判 + 详情展示)+ 纠正者/时间(留痕)
    human_note_zh = models.CharField(max_length=1000, blank=True, default="")
    human_note_ja = models.CharField(max_length=1000, blank=True, default="")
    corrected_by = models.CharField(max_length=120, blank=True, default="")
    corrected_at = models.DateTimeField(null=True, blank=True)
    # 信息完整性/留痕缺口: 状态与材料明显矛盾或材料不足以解释当前状态 → 要求人补充。
    # (例: 卡被标记完成但无完成说明 → AI 无从解释 → 提醒补一句收尾以完整留痕)
    needs_info = models.BooleanField(default=False, db_index=True)
    info_gap_zh = models.CharField(max_length=300, blank=True, default="")
    info_gap_ja = models.CharField(max_length=300, blank=True, default="")
    # 补充框架(needs_info 时,结合本卡情况告诉补充人该写什么;双语,按阅览者语言展示)
    info_framework_zh = models.TextField(blank=True, default="")
    info_framework_ja = models.TextField(blank=True, default="")
    # BARSOUL DIS 子树 rollup(父任务汇总子任务态): 决策全 code(球/分类/收尾/计数 + join approval/snooze SoR),
    # 叙述 gemma(reasoning/tension, schema 隔离不碰球)。ball/actor/next_action 等复用上面字段(code 定)。
    is_parent = models.BooleanField(default=False, db_index=True)  # 有子任务 → 本行是 rollup 结果
    subtree_total = models.PositiveSmallIntegerField(default=0)
    subtree_active = models.PositiveSmallIntegerField(default=0)
    subtree_done = models.PositiveSmallIntegerField(default=0)
    subtree_blocked = models.PositiveSmallIntegerField(default=0)  # 冻结(审批中)+ 高停滞 子数(红点信号)
    rep_child = models.ForeignKey(  # 代表子(球所在的活跃子)→ 卡顶可点跳
        Issue, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    subtree_tension_zh = models.CharField(max_length=300, blank=True, default="")  # gemma 点名的口径矛盾
    subtree_tension_ja = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        verbose_name = "Issue AI State"
        verbose_name_plural = "Issue AI States"
        db_table = "issue_ai_states"
        indexes = [
            models.Index(fields=["project", "state"]),
            models.Index(fields=["workspace", "ball", "owner"]),
        ]

    def __str__(self):
        return f"{self.issue_id}:{self.state}"


# BARSOUL: 人工纠正/补充 审计表(append-only, 留痕可追溯)。每次人进详情向 AI
# 补足背景说明记一行(双语 + 当时的旧 ball/actor)。绝不污染 SoR。
class IssueAIStateCorrection(ProjectBaseModel):
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="ai_state_corrections")
    note_zh = models.CharField(max_length=1000, blank=True, default="")
    note_ja = models.CharField(max_length=1000, blank=True, default="")
    note_lang = models.CharField(max_length=8, blank=True, default="")  # 录入原文语言
    prev_ball = models.CharField(max_length=8, blank=True, default="")
    prev_actor = models.CharField(max_length=120, blank=True, default="")

    class Meta:
        verbose_name = "Issue AI State Correction"
        verbose_name_plural = "Issue AI State Corrections"
        db_table = "issue_ai_state_corrections"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["issue", "-created_at"])]

    def __str__(self):
        return f"{self.issue_id}:correction:{self.created_at}"


# BARSOUL Inbox Phase3 (hechun 2026-07-07): 个人收件箱分流状态 (per-user, per-issue 派生投影)。
# 「我的工作」digest の 完成/归档/Snooze/Pin/Mute 的落点。纯个人视图状态 → 读时投影:
# digest 过滤 done_at/archived_at/未来 snoozed_till, pinned 置顶。**绝不写 SoR**:
# Issue.snoozed_until 是全局字段(snooze 一次全队都看不到该卡)→ 严禁复用; 个人 snooze 只落本表。
# 审批/托管中卡的冻结: ①审批组永远从 ai-bot 权威渲染, 本表无法隐藏它 ②triage 服务层对隐藏动作
# 查 ai-bot my-pending 命中则拒(fail-open, 渲染层已兜底)。每 (user, issue) 唯一一行, upsert。
class InboxState(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="inbox_states", on_delete=models.CASCADE)
    project = models.ForeignKey("db.Project", related_name="inbox_states", on_delete=models.CASCADE)
    user = models.ForeignKey("db.User", related_name="inbox_states", on_delete=models.CASCADE)
    issue = models.ForeignKey(Issue, related_name="inbox_states", on_delete=models.CASCADE)
    read_at = models.DateTimeField(null=True, blank=True)
    done_at = models.DateTimeField(null=True, blank=True)       # 用户「完成/清出队」标记(不改 issue SoR 状态)
    archived_at = models.DateTimeField(null=True, blank=True)   # 知会类看过归档(可搜回)
    snoozed_till = models.DateTimeField(null=True, blank=True)  # 个人 snooze 到某时刻回队
    pinned = models.BooleanField(default=False)
    muted = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Inbox State"
        verbose_name_plural = "Inbox States"
        db_table = "inbox_states"
        ordering = ("-updated_at",)
        unique_together = ("user", "issue")
        indexes = [
            models.Index(fields=["user", "workspace"], name="inbox_user_ws_idx"),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.issue_id}"
