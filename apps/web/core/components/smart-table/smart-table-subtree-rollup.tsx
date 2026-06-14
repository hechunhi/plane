/**
 * BARSOUL B-4c: 子树台账汇总 — 用户终验痛点「我需要在一个任务里看到所有子任务
 * 状态, 不然一堆子任务会失控」(BS-216)。总卡打开即见子树全部台账行(只读 glide,
 * 铁律: 表格一律 glide), 末列=来源卡(点击 SPA peek)。列已由后端裁剪为有值列。
 * 显示条件: 子树行 ≥2(单行场景卡自身表单已覆盖, 不重复)。
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { DataEditor, GridCellKind, type GridCell, type GridColumn, type Item } from "@glideapps/glide-data-grid";
import type { TIssue } from "@plane/types";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { smartTableService, type TSubtreeRowGroups } from "@/services/smart-table.service";
import { CUSTOM_RENDERERS, cellForColumn, defaultColW, getGlideTheme, gridFill, useGridWidth, useIsDark } from "./smart-table-cells";

// 汇总: 列宽 gridFill 按容器内容宽精确填满(数据列摊余量+末列吃余数=零缝、零空白列), 可拖(内存态, 不碰
// localStorage 免污染), 溢出时容器高 +滚动条高 → 无纵向条。2026-06-15 多轮(空列/塌列/双滚动条)后定案。

type Props = { issueId: string };

const ROW_H = 34;
const trN = (x: { name: string; i18n?: Record<string, { name?: string }> }, lang: string) => x.i18n?.[lang]?.name || x.name;

export const SmartTableSubtreeRollup = observer(function SmartTableSubtreeRollup({ issueId }: Props) {
  const zh = useZh();
  const dark = useIsDark();
  const lang = zh ? "zh" : "ja";
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { handleRedirection } = useIssuePeekOverviewRedirection();
  const issue = getIssueById(issueId);
  const projectId = issue?.project_id;
  const hasChildren = (issue?.sub_issues_count ?? 0) > 0;

  const { data } = useSWR<TSubtreeRowGroups>(
    hasChildren && workspaceSlug && projectId && issueId ? `SUBTREE_ROWS:${issueId}` : null,
    () => smartTableService.getSubtreeRows(workspaceSlug!, projectId!, issueId),
    { dedupingInterval: 30_000, revalidateOnFocus: true }
  );

  const theme = useMemo(() => getGlideTheme(dark, "table"), [dark]); // 用户走查 2026-06-14: 还原 data-grid 网格质感
  const [wrapRef, gridW] = useGridWidth<HTMLDivElement>(); // 多分组共用外层宽(各组皆满宽块级)
  const [colW, setColW] = useState<Record<string, number>>({}); // 列宽拖动: 内存态(刷新即回默认填满, 不持久化免污染)
  const groups = (data?.groups ?? []).filter((g) => g.rows.length >= 2);

  const openSource = useCallback(
    (src: { id: string; sequence_id: number; project: string }) => {
      if (!workspaceSlug) return;
      const full = getIssueById(src.id);
      handleRedirection(
        workspaceSlug,
        full ?? ({ id: src.id, project_id: src.project, sequence_id: src.sequence_id } as unknown as TIssue)
      );
    },
    [workspaceSlug, getIssueById, handleRedirection]
  );

  if (groups.length === 0) return null;
  const T = zh ? { title: "关联数据汇总", rows: "行", src: "来源" } : { title: "関連データ集計", rows: "行", src: "由来" };

  return (
    <div ref={wrapRef} className="mt-3 space-y-3">
      {groups.map((g) => {
        const cid = (key: string) => `${g.table.id}::${key}`;
        const { widths, overflow } = gridFill(
          [
            ...g.columns.map((c) => ({ id: cid(c.key), base: defaultColW(c.type), flex: true })),
            { id: cid("__src"), base: 84, flex: false },
          ],
          gridW, colW
        );
        const gridColumns: GridColumn[] = [
          ...g.columns.map((c) => ({ title: trN(c, lang), id: cid(c.key), width: widths[cid(c.key)] })),
          { title: T.src, id: cid("__src"), width: widths[cid("__src")] },
        ];
        const getCellContent = ([col, row]: Item): GridCell => {
          const r = g.rows[row];
          if (!r) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
          if (col < g.columns.length) return cellForColumn(g.columns[col], r.cells[g.columns[col].key], dark, false, lang);
          const label = `#${r.source.sequence_id}`;
          return {
            kind: GridCellKind.Text, data: label, displayData: label, allowOverlay: false,
            contentAlign: "center",
            themeOverride: { textDark: dark ? "#2893cc" : "#006399" },
          };
        };
        const onCellClicked = ([col, row]: Item) => {
          const r = g.rows[row];
          if (r && col === g.columns.length) openSource(r.source);
        };
        const height = 34 + g.rows.length * ROW_H + 2 + (overflow ? 11 : 0); // 头34+行+边框2(+横向条10见globals.css→无纵向条)
        return (
          <div key={g.table.id}>
            <div className="mb-1 text-11 font-semibold uppercase tracking-wide text-placeholder">
              {T.title} · {trN(g.table, lang)}({g.rows.length}{T.rows})
            </div>
            <div className="smart-glide-scroll overflow-hidden rounded-md border border-subtle" style={{ height }}>
              <DataEditor
                columns={gridColumns}
                rows={g.rows.length}
                getCellContent={getCellContent}
                onCellClicked={onCellClicked}
                onColumnResize={(col, newSize) => { if (col.id) setColW((p) => ({ ...p, [col.id!]: Math.max(40, Math.round(newSize)) })); }}
                customRenderers={CUSTOM_RENDERERS}
                theme={theme}
                headerHeight={34}
                rowHeight={ROW_H}
                rowMarkers="none"
                columnSelect="none"
                rowSelect="none"
                width={(gridW > 2 ? gridW - 2 : 0) || "100%"}
                height="100%"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});
