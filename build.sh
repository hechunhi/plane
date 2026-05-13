#!/usr/bin/env bash
# Build BARSOUL custom Plane images from source.
# Tag: makeplane/plane-{name}:barsoul-1.3.0
#   ← matches APP_RELEASE=barsoul-1.3.0 in plane.env, so cli/community compose picks local images

set -euo pipefail
cd "$(dirname "$0")"

TAG="${TAG:-barsoul-1.3.0}"
echo "=== Building Plane images, tag: $TAG ==="
echo ""

build() {
    local name="$1"     # makeplane suffix (frontend/admin/space/live/backend/proxy)
    local dockerfile="$2"
    local context="$3"
    echo ""
    echo "━━━ [$(date +%H:%M:%S)] Building makeplane/plane-${name}:${TAG} ━━━"
    docker build \
        -f "$dockerfile" \
        -t "makeplane/plane-${name}:${TAG}" \
        "$context"
}

# 順番: backend (一番小さい) → proxy → live → frontend → admin → space
# (大きい frontend を最後に回し、失敗時の rollback が楽)
build backend  ./apps/api/Dockerfile.api      ./apps/api
build proxy    ./apps/proxy/Dockerfile.ce     ./apps/proxy
build live     ./apps/live/Dockerfile.live    .
build frontend ./apps/web/Dockerfile.web      .
build admin    ./apps/admin/Dockerfile.admin  .
build space    ./apps/space/Dockerfile.space  .

echo ""
echo "=== 完了 ==="
docker images | grep "makeplane/plane-.*:${TAG}"
