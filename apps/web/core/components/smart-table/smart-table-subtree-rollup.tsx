/**
 * BARSOUL B-4c: 子树台账汇总 — 用户终验痛点「我需要在一个任务里看到所有子任务
 * 状态, 不然一堆子任务会失控」(BS-216)。总卡打开即见子树全部台账行(只读 glide,
 * 铁律: 表格一律 glide), 末列=来源卡(点击 SPA peek)。列已由后端裁剪为有值列。
 * 显示条件: 子树行 ≥2(单行场景卡自身表单已覆盖, 不重复)。
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Maximize2 } from "lucide-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { DataEditor, GridCellKind, type GridCell, type GridColumn, type Item } from "@glideapps/glide-data-grid";
import type { TIssue } from "@plane/types";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { smartTableService, type TSubtreeRowGroups, type TSmartColumn } from "@/services/smart-table.service";
import {
  CUSTOM_RENDERERS,
  cellForColumn,
  defaultColW,
  getGlideTheme,
  gridFill,
  useGridWidth,
  useIsDark,
} from "./smart-table-cells";
import { SmartTableRowDetailModal } from "./smart-table-row-detail";

// 汇总: 列宽 gridFill 按容器内容宽精确填满(数据列摊余量+末列吃余数=零缝、零空白列), 可拖(内存态, 不碰
// localStorage 免污染), 溢出时容器高 +滚动条高 → 无纵向条。2026-06-15 多轮(空列/塌列/双滚动条)后定案。

type Props = { issueId: string };

const ROW_H = 34;
const trN = (x: { name: string; i18n?: Record<string, { name?: string }> }, lang: string) =>
  x.i18n?.[lang]?.name || x.name;

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
  const [detail, setDetail] = useState<{
    title: string;
    columns: TSmartColumn[];
    cells: Record<string, unknown>;
  } | null>(null); // 行→转置详情(只读卡)
  const [hoverRow, setHoverRow] = useState<Record<string, number>>({}); // 各分组 hover 的行 → 行首 ⛶ 仅 hover 该行时显示(不常驻)
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
  const T = zh
    ? { title: "关联数据汇总", rows: "行", src: "来源" }
    : { title: "関連データ集計", rows: "行", src: "由来" };

  return (
    <div ref={wrapRef} className="mt-3 space-y-3">
      {groups.map((g) => {
        const cid = (key: string) => `${g.table.id}::${key}`;
        const { widths, overflow } = gridFill(
          [
            ...g.columns.map((c) => ({ id: cid(c.key), base: defaultColW(c.type), flex: true })),
            { id: cid("__src"), base: 84, flex: false },
          ],
          gridW,
          colW
        );
        const gridColumns: GridColumn[] = [
          ...g.columns.map((c) => ({ title: trN(c, lang), id: cid(c.key), width: widths[cid(c.key)] })),
          { title: T.src, id: cid("__src"), width: widths[cid("__src")] },
        ];
        const firstColW = widths[cid(g.columns[0]?.key ?? "")] ?? 120; // 第一列宽 → ⛶ 浮层贴其右缘内侧
        const getCellContent = ([col, row]: Item): GridCell => {
          const r = g.rows[row];
          if (!r) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
          if (col < g.columns.length)
            return cellForColumn(g.columns[col], r.cells[g.columns[col].key], dark, false, lang);
          const label = `#${r.source.sequence_id}`; // 末列=来源卡
          return {
            kind: GridCellKind.Text,
            data: label,
            displayData: label,
            allowOverlay: false,
            contentAlign: "center",
            themeOverride: { textDark: dark ? "#2893cc" : "#006399" },
          };
        };
        const onCellClicked = ([col, row]: Item) => {
          const r = g.rows[row];
          if (r && col === g.columns.length) openSource(r.source); // 末列=来源卡; 数据格留 glide 选中/Ctrl+C, 展开走 ⛶ 浮层
        };
        const openRowDetail = (r: (typeof g.rows)[number]) =>
          setDetail({
            title: `#${r.source.sequence_id} · ${trN(g.table, lang)}`,
            // 全量拷贝列对象(含 options 等渲染字段; 漏 options 单选 .find 崩), 强制只读
            columns: g.columns.map((c) => ({ ...c, source: "derived", editable: false })) as unknown as TSmartColumn[],
            cells: r.cells,
          });
        const height = 34 + g.rows.length * ROW_H + 2 + (overflow ? 11 : 0); // 头34+行+边框2(+横向条10见globals.css→无纵向条)
        return (
          <div key={g.table.id}>
            <div className="mb-1 text-11 font-semibold tracking-wide text-placeholder uppercase">
              {T.title} · {trN(g.table, lang)}({g.rows.length}
              {T.rows})
            </div>
            <div
              className="smart-glide-scroll relative overflow-hidden rounded-md border border-subtle"
              style={{ height }}
              onMouseLeave={() => setHoverRow((p) => (p[g.table.id] == null ? p : { ...p, [g.table.id]: -1 }))}
            >
              <DataEditor
                columns={gridColumns}
                rows={g.rows.length}
                getCellContent={getCellContent}
                onCellClicked={onCellClicked}
                onItemHovered={(args) => {
                  const row = args.location[1];
                  setHoverRow((p) => (p[g.table.id] === row ? p : { ...p, [g.table.id]: row }));
                }}
                onColumnResize={(col, newSize) => {
                  if (col.id) setColW((p) => ({ ...p, [col.id!]: Math.max(40, Math.round(newSize)) }));
                }}
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
              {/* ⛶ 行展开浮层: 不占列, 仅 hover 该行时贴第一列右缘浮现(lucide 矢量); 点它弹转置详情。
                  鼠标移到本按钮仍在容器内(不触发 onMouseLeave)→ 不闪。rollup 无垂直滚动 → top 直接算。 */}
              {(() => {
                const hr = hoverRow[g.table.id];
                if (hr == null || hr < 0 || hr >= g.rows.length) return null;
                const r = g.rows[hr];
                return (
                  <button
                    type="button"
                    title={zh ? "展开为表单" : "フォームで展開"}
                    onClick={() => openRowDetail(r)}
                    className="shadow-sm absolute z-10 grid size-5 place-items-center rounded border-[0.5px] border-subtle bg-surface-1/95 text-tertiary backdrop-blur-sm transition-colors hover:bg-layer-1 hover:text-primary"
                    style={{ top: 34 + hr * ROW_H + (ROW_H - 20) / 2, left: Math.max(4, firstColW - 26) }}
                  >
                    <Maximize2 className="size-3" />
                  </button>
                );
              })()}
            </div>
          </div>
        );
      })}
      {detail && (
        <SmartTableRowDetailModal
          title={detail.title}
          columns={detail.columns}
          cells={detail.cells}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
});
