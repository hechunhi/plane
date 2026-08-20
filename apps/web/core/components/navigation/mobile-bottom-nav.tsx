/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel, WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Plus } from "lucide-react";
import { cn, joinUrlPath } from "@plane/utils";
// hooks
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useUserPermissions } from "@/hooks/store/user";
// plane web imports
import { getSidebarNavigationItemIcon } from "@/plane-web/components/workspace/sidebar/helper";

/**
 * BARSOUL 2026-08 — スマホ用の下部タブバー + 作成 FAB。
 *
 * 背景: スマホではワークスペース階層の移動が「左上のハンバーガー → ドロワー」しか無く、
 * 親指の届かない画面最上部を毎回触る必要があった。新規作成も同じくヘッダ右上。
 * Trello のモバイルが速く感じる理由の大半はここ(主要導線が全部下にある)。
 *
 * 情報設計は**増やしていない**。ここに出すのはサイドバーの常显項目
 * (`WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS`)からそのまま 4 つ持ってきただけで、
 * 遷移先・権限・ハイライト判定・アイコン・訳語も全部サイドバーと同じ関数を使う。
 * = 「サイドバーの一軍を親指の届く所にも出した」だけ。md 以上では出さない。
 */
/**
 * BARSOUL 2026-08: 4 枠目は「受信トレイ(= 通知)」ではなく「ToDo」。
 * 通知はグローバルヘッダの封筒に未読バッジ付きで既に出ているので、
 * 下部タブに二重で置く価値が無かった。代わりに、どこからでも親指一本で開ける
 * 個人の ToDo(= 下書き一覧)を置く。ここが「まず書き留める」の入口になる。
 */
const MOBILE_BOTTOM_NAV_KEYS = ["home", "my-work", "projects", "drafts"] as const;

export const MobileBottomNav = observer(function MobileBottomNav() {
  // router
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  // i18n
  const { t } = useTranslation();
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { toggleCreateIssueModal } = useCommandPalette();

  const slug = workspaceSlug?.toString() ?? "";
  if (!slug) return null;

  const canCreateWorkItem = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    slug
  );

  const items = MOBILE_BOTTOM_NAV_KEYS.map((key) => WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS[key]).filter(
    (item) => !!item && allowPermissions(item.access, EUserPermissionsLevel.WORKSPACE, slug)
  );

  if (items.length === 0) return null;

  return (
    <nav
      /**
       * BARSOUL 2026-08 実機修正: ラベルが下端で切れていた件。
       * 原因はここではなくアプリのルート高 (`h-screen` = 100vh) だったが、
       * 併せて下端の余白規則も明示する:
       *   pb = max(ホームインジケータ帯, 6px)
       * env() が 0 の端末(Android / デスクトップ幅)でもタブが枠にベタ付きせず、
       * iPhone ではインジケータに被らない。max() なので機種別の分岐は不要。
       */
      className="z-[20] flex shrink-0 items-stretch gap-1 border-t border-subtle bg-surface-1 px-1 pt-0.5 pb-[max(env(safe-area-inset-bottom),0.375rem)] md:hidden"
    >
      {items.map((item) => {
        const href = joinUrlPath(slug, item.href);
        const isActive = item.highlight(pathname, href);
        return (
          <Link
            key={item.key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md py-1.5",
              // accent = 現在地。非選択は tertiary のまま(色数を増やさない)。
              isActive ? "text-accent-primary" : "text-tertiary"
            )}
          >
            <span className="flex items-center justify-center">
              {getSidebarNavigationItemIcon(item.key, "size-5")}
            </span>
            <span className="max-w-full truncate text-11 leading-none font-medium">{t(item.labelTranslationKey)}</span>
          </Link>
        );
      })}
      {canCreateWorkItem && (
        <button
          type="button"
          onClick={() => toggleCreateIssueModal(true)}
          aria-label={t("issue.add.label")}
          className="my-1 flex size-11 shrink-0 items-center justify-center self-center rounded-full bg-accent-primary text-on-color shadow-md hover:bg-accent-primary-hover active:bg-accent-primary-active"
        >
          <Plus className="size-5" strokeWidth={2.5} />
        </button>
      )}
    </nav>
  );
});
