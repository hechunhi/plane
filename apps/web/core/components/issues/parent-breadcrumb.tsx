/**
 * BARSOUL B-2m: 看板/列表卡片の所属面包屑 — 子卡(流程站卡等)に「↳ 親卡名」を
 * 1 行小字で表示。経緯: B-2k で子卡を看板から全部隠した→ユーザ否決(「完全に
 * 見えないのは違う」)→ 回滚し、平铺迷失は本コンポで解決(見える+帰属が分かる)。
 * 親卡が store 未ロードなら静默非表示(優雅降級)。
 */
import { observer } from "mobx-react";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

type Props = { parentId: string | null | undefined; className?: string; inline?: boolean };

export const ParentBreadcrumb = observer(function ParentBreadcrumb({ parentId, className, inline }: Props) {
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  if (!parentId) return null;
  const parent = getIssueById(parentId);
  if (!parent?.name) return null;
  if (inline)
    return (
      <span className={`ml-2 max-w-44 shrink-0 truncate text-10 text-tertiary ${className ?? ""}`} title={parent.name}>
        ↳ {parent.name}
      </span>
    );
  return (
    <div className={`line-clamp-1 w-full text-10 text-tertiary ${className ?? ""}`} title={parent.name}>
      ↳ {parent.name}
    </div>
  );
});
