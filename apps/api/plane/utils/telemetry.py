# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os
import atexit

# Third party imports
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.django import DjangoInstrumentor

# Global variable to track initialization
_TRACER_PROVIDER = None


def init_tracer():
    """Initialize OpenTelemetry with proper shutdown handling"""
    global _TRACER_PROVIDER

    # BARSOUL: 既定の OTLP エクスポータは gRPC で telemetry.plane.so:4317 へ
    # phone-home する。当社環境ではこのエンドポイントが到達不能で、しかも
    # gRPC は fork 非安全。Celery prefork の子プロセスで init_tracer →
    # finally: shutdown_tracer() の force_flush が無限ブロックし、pool スロット
    # が恒久 busy 化 → 全 Celery タスク（notification 含む）が実行されず
    # Plane 受信箱に通知が届かない根本原因だった。
    # テレメトリは不要（プライバシー上も送りたくない）ため完全に無効化する。
    # 復活させたい場合は OTEL_ENABLED=1 かつ到達可能な OTLP_ENDPOINT を設定し、
    # かつ prefork ではなく solo/threads pool で動かすこと。
    if os.environ.get("OTEL_ENABLED", "0") != "1":
        return None

    # If already initialized, return existing provider
    if _TRACER_PROVIDER is not None:
        return _TRACER_PROVIDER

    # Configure the tracer provider
    service_name = os.environ.get("SERVICE_NAME", "plane-ce-api")
    resource = Resource.create({"service.name": service_name})
    tracer_provider = TracerProvider(resource=resource)

    # Set as global tracer provider
    trace.set_tracer_provider(tracer_provider)

    # Configure the OTLP exporter
    otel_endpoint = os.environ.get("OTLP_ENDPOINT", "https://telemetry.plane.so")
    otlp_exporter = OTLPSpanExporter(endpoint=otel_endpoint)
    span_processor = BatchSpanProcessor(otlp_exporter)
    tracer_provider.add_span_processor(span_processor)

    # Initialize Django instrumentation
    DjangoInstrumentor().instrument()

    # Store provider globally
    _TRACER_PROVIDER = tracer_provider

    # Register shutdown handler
    atexit.register(shutdown_tracer)

    return tracer_provider


def shutdown_tracer():
    """Shutdown OpenTelemetry tracers and processors"""
    global _TRACER_PROVIDER

    if _TRACER_PROVIDER is not None:
        if hasattr(_TRACER_PROVIDER, "shutdown"):
            _TRACER_PROVIDER.shutdown()
        _TRACER_PROVIDER = None
