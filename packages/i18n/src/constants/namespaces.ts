/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const NAMESPACES = [
  "accessibility",
  "auth",
  // BARSOUL: 自社追加キーは全部ここ(locales/*/barsoul.json)。上流 namespace と分けておけば次回升级で衝突しない。
  // fallbackNS で全 namespace を引くので、キー名は従来どおり(sidebar.weekly 等)で解決される。
  "barsoul",
  "automation",
  "common",
  "cycle",
  "editor",
  "empty-state",
  "home",
  "inbox",
  "integration",
  "module",
  "navigation",
  "notification",
  "page",
  "power-k",
  "project",
  "project-settings",
  "settings",
  "stickies",
  "template",
  "tour",
  "update",
  "wiki",
  "work-item",
  "work-item-type",
  "workflow",
  "workspace",
  "workspace-settings",
] as const;

export type TNamespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: TNamespace = "common";
