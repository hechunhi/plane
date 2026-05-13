# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from .workspace_project_join import process_workspace_project_invitations
from .default_workspace_auto_join import process_default_workspace_join


def post_user_auth_workflow(user, is_signup, request):
    # 1. Apply any pending invites the user has already accepted.
    process_workspace_project_invitations(user=user)
    # 2. BARSOUL customization: auto-join SSO users to a default workspace
    #    (controlled by PLANE_DEFAULT_WORKSPACE_SLUG env, opt-in).
    process_default_workspace_join(user=user, is_signup=is_signup)
