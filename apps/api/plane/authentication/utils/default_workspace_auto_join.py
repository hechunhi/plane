# Copyright (c) 2026 BARSOUL customizations
# Auto-join newly authenticated users to a default workspace (and optionally
# all its projects). Opt-in via environment variables.

import os
import logging

from plane.db.models import (
    Workspace,
    WorkspaceMember,
    Project,
    ProjectMember,
)

logger = logging.getLogger("plane")


def _get_int_env(key, default):
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return int(default)


def _bool_env(key):
    return os.environ.get(key, "").lower() in ("true", "1", "yes", "on")


def process_default_workspace_join(user, is_signup=False):
    """
    Auto-add the user to a default workspace + projects when configured via
    env. Useful for SSO single-tenant setups where every authenticated user
    should land in the company workspace without manual invitation.

    Env:
      PLANE_DEFAULT_WORKSPACE_SLUG   — workspace slug to auto-join (required)
      PLANE_DEFAULT_WORKSPACE_ROLE   — role int, default 15 (Member)
      PLANE_AUTO_JOIN_PROJECTS       — "true" to also join all projects

    Idempotent — skips users who are already a workspace member.
    """
    slug = os.environ.get("PLANE_DEFAULT_WORKSPACE_SLUG")
    if not slug:
        return

    try:
        ws = Workspace.objects.get(slug=slug)
    except Workspace.DoesNotExist:
        logger.warning(
            "PLANE_DEFAULT_WORKSPACE_SLUG=%s set but workspace not found", slug
        )
        return

    if WorkspaceMember.objects.filter(workspace=ws, member=user).exists():
        return

    role = _get_int_env("PLANE_DEFAULT_WORKSPACE_ROLE", 15)
    WorkspaceMember.objects.create(workspace=ws, member=user, role=role)
    logger.info(
        "Auto-joined %s to workspace %s (role=%d)", user.email, slug, role
    )

    if _bool_env("PLANE_AUTO_JOIN_PROJECTS"):
        created = 0
        for project in Project.objects.filter(workspace=ws):
            _, was_created = ProjectMember.objects.get_or_create(
                workspace=ws,
                project=project,
                member=user,
                defaults={"role": role},
            )
            if was_created:
                created += 1
        logger.info(
            "Auto-joined %s to %d project(s) in workspace %s",
            user.email,
            created,
            slug,
        )
