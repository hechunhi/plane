/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { AuthRoot } from "@/components/account/auth-forms/auth-root";
import type { EAuthModes } from "@/helpers/authentication.helper";
import { AuthHeader } from "./header";

type AuthBaseProps = {
  authType: EAuthModes;
};

// BARSOUL: 社内ツール用にログイン画面を簡素化。
// Plane 標準の AuthFooter(「Join 10,000+ teams」+ ZERODHA/SONY/Dolby/Accenture
// ブランドロゴ)はマーケ要素なので非表示。Google のみのカードを縦中央に配置。
export function AuthBase({ authType }: AuthBaseProps) {
  return (
    <div className="relative z-10 flex h-screen w-screen flex-col overflow-hidden overflow-y-auto px-8 py-6">
      <AuthHeader type={authType} />
      <div className="flex w-full flex-1 items-center justify-center">
        <AuthRoot authMode={authType} />
      </div>
    </div>
  );
}
