# Generic OIDC provider — implemented for BARSOUL Office Authelia SSO
# Mirrors the gitea.py / google.py pattern.

import os
from datetime import datetime, timedelta
from urllib.parse import urlencode, urlparse

import pytz
import requests

from plane.authentication.adapter.oauth import OauthAdapter
from plane.license.utils.instance_value import get_configuration_value
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)


class AutheliaOAuthProvider(OauthAdapter):
    provider = "authelia"
    scope = "openid email profile"

    def __init__(self, request, code=None, state=None, callback=None):
        (
            AUTHELIA_CLIENT_ID,
            AUTHELIA_CLIENT_SECRET,
            AUTHELIA_HOST,
            AUTHELIA_INTERNAL_URL,
        ) = get_configuration_value(
            [
                {
                    "key": "AUTHELIA_CLIENT_ID",
                    "default": os.environ.get("AUTHELIA_CLIENT_ID"),
                },
                {
                    "key": "AUTHELIA_CLIENT_SECRET",
                    "default": os.environ.get("AUTHELIA_CLIENT_SECRET"),
                },
                {
                    "key": "AUTHELIA_HOST",
                    "default": os.environ.get("AUTHELIA_HOST"),
                },
                {
                    # Optional — server-side host for token/userinfo calls.
                    # Use this when AUTHELIA_HOST is a public domain that
                    # the Plane backend container cannot resolve (e.g. behind
                    # reverse-proxy with self-signed TLS). Falls back to
                    # AUTHELIA_HOST.
                    "key": "AUTHELIA_INTERNAL_URL",
                    "default": os.environ.get("AUTHELIA_INTERNAL_URL"),
                },
            ]
        )

        if not (AUTHELIA_CLIENT_ID and AUTHELIA_CLIENT_SECRET and AUTHELIA_HOST):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["AUTHELIA_NOT_CONFIGURED"],
                error_message="AUTHELIA_NOT_CONFIGURED",
            )

        parsed = urlparse(AUTHELIA_HOST)
        if not parsed.scheme or parsed.scheme not in ("https", "http"):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["AUTHELIA_NOT_CONFIGURED"],
                error_message="AUTHELIA_NOT_CONFIGURED",
            )
        AUTHELIA_HOST = AUTHELIA_HOST.rstrip("/")
        AUTHELIA_INTERNAL_URL = (AUTHELIA_INTERNAL_URL or AUTHELIA_HOST).rstrip("/")

        # Browser-facing URL (sent in 302 to the user's browser).
        # Token / userinfo calls are server-side from this container,
        # so they go via AUTHELIA_INTERNAL_URL — defaults to AUTHELIA_HOST.
        self.token_url = f"{AUTHELIA_INTERNAL_URL}/api/oidc/token"
        self.userinfo_url = f"{AUTHELIA_INTERNAL_URL}/api/oidc/userinfo"

        client_id = AUTHELIA_CLIENT_ID
        client_secret = AUTHELIA_CLIENT_SECRET

        redirect_uri = (
            f"{'https' if request.is_secure() else 'http'}://"
            f"{request.get_host()}/auth/authelia/callback/"
        )
        url_params = {
            "client_id": client_id,
            "scope": self.scope,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }
        auth_url = f"{AUTHELIA_HOST}/api/oidc/authorization?{urlencode(url_params)}"

        super().__init__(
            request,
            self.provider,
            client_id,
            self.scope,
            redirect_uri,
            auth_url,
            self.token_url,
            self.userinfo_url,
            client_secret,
            code,
            callback=callback,
        )

    def _internal_proxy_headers(self):
        """
        When AUTHELIA_INTERNAL_URL points at http://authelia:9091 (in-cluster),
        Authelia still constructs the OIDC issuer from the public AUTHELIA_HOST
        and requires X-Forwarded-Proto/Host headers to match. Inject them.
        """
        parsed = urlparse(self.userinfo_url)
        public = urlparse(os.environ.get("AUTHELIA_HOST", ""))
        if parsed.scheme == "http" and public.scheme == "https":
            return {
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": public.netloc,
            }
        return {}

    def set_token_data(self):
        data = {
            "code": self.code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }
        headers = {"Accept": "application/json", **self._internal_proxy_headers()}
        token_response = self.get_user_token(data=data, headers=headers)
        super().set_token_data(
            {
                "access_token": token_response.get("access_token"),
                "refresh_token": token_response.get("refresh_token", None),
                "access_token_expired_at": (
                    datetime.now(tz=pytz.utc)
                    + timedelta(seconds=token_response.get("expires_in"))
                    if token_response.get("expires_in")
                    else None
                ),
                "refresh_token_expired_at": None,
                "id_token": token_response.get("id_token", ""),
            }
        )

    def get_user_response(self):
        """Override base to inject X-Forwarded-* headers for internal calls."""
        try:
            headers = {
                "Authorization": f"Bearer {self.token_data.get('access_token')}",
                **self._internal_proxy_headers(),
            }
            response = requests.get(self.get_user_info_url(), headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["AUTHELIA_OAUTH_PROVIDER_ERROR"],
                error_message="AUTHELIA_OAUTH_PROVIDER_ERROR: userinfo call failed",
            )

    def set_user_data(self):
        user_info_response = self.get_user_response()

        # Authelia OIDC userinfo response keys (standard OIDC claims):
        #   sub            — subject (unique user id, e.g. "hechun")
        #   email          — user email
        #   email_verified — bool
        #   name           — display name
        #   preferred_username — login name
        #   groups         — list of group names
        email = user_info_response.get("email")
        if not email:
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["AUTHELIA_OAUTH_PROVIDER_ERROR"],
                error_message="AUTHELIA_OAUTH_PROVIDER_ERROR: No email in userinfo",
            )

        # Display name preference: name > preferred_username > email local-part
        display_name = (
            user_info_response.get("name")
            or user_info_response.get("preferred_username")
            or email.split("@", 1)[0]
        )

        # Split display name into first/last for Plane's user model
        parts = display_name.split(maxsplit=1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else ""

        super().set_user_data(
            {
                "email": email,
                "user": {
                    "provider_id": str(user_info_response.get("sub")),
                    "email": email,
                    "avatar": user_info_response.get("picture", ""),
                    "first_name": first_name,
                    "last_name": last_name,
                    "is_password_autoset": True,
                },
            }
        )
