/**
 * BARSOUL: 智能表「字段」配置视图 v2 — master-detail. 见 docs/architecture/smart-table-mvp.md.
 * v1 的灾难(用户点名): 每行塞 14 个无字图标按钮 + 选项挤行内 → 重做:
 * 左=字段列表(↑↓排序持久化 / 类型图标+名称+类型字 / 必填·派生徽标), 右=选中字段编辑面板
 * (名称 / 类型网格=图标+文字 / 必填 / 选项块 / 两段式删除)。派生列=只读说明。全 Plane token.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Plus, Trash2, X, ChevronUp, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@plane/utils";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import {
  smartTableService,
  type TSmartColumn,
  type TSmartColumnType,
  type TSmartSelectOption,
  type TSmartTable,
} from "@/services/smart-table.service";
import { TYPE_META } from "./smart-table-cells";

const PALETTE = ["#e0567a", "#c9921f", "#2f7fd1", "#13a3a3", "#d97a0a", "#16a34a", "#7c5cff", "#7a8088"];
const SELECTABLE = new Set<TSmartColumnType>(["single_select", "multi_select"]);

type Props = { ws: string; pid: string; table: TSmartTable; focusColumnId?: string | null };

export function SmartTableFields({ ws, pid, table, focusColumnId }: Props) {
  const zh = useZh();
  const [cols, setCols] = useState<TSmartColumn[]>(table.columns);
  const [selectedId, setSelectedId] = useState<string | null>(table.columns[0]?.id ?? null);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setCols(table.columns);
    setSelectedId((cur) => (cur && table.columns.some((c) => c.id === cur) ? cur : (table.columns[0]?.id ?? null)));
  }, [table.id, table.columns]);

  // 列头菜单「字段设置…」深链: 进入即选中该列(校验存在, 防切表后陈旧 id 空面板)
  useEffect(() => {
    if (focusColumnId && table.columns.some((c) => c.id === focusColumnId)) setSelectedId(focusColumnId);
  }, [focusColumnId, table.columns]);

  const sel = cols.find((c) => c.id === selectedId) ?? null;
  useEffect(() => {
    setNameDraft(sel?.name ?? "");
    setConfirmDel(false);
  }, [selectedId, sel?.name]);

  const T = zh
    ? {
        hint: "左边选字段,右边改名称 / 类型 / 选项 / 必填;↑↓ 调列顺序。",
        add: "添加字段",
        empty: "还没有字段",
        name: "名称",
        type: "类型",
        required: "必填字段",
        reqHint: "卡片完成时未填会标「待补全」",
        options: "选项",
        addOpt: "添加选项",
        del: "删除字段",
        delConfirm: "确认删除?数据会丢",
        derived: "派生列 · 只读投影",
        derivedHint: "值由卡片 / AI / keiri 自动算出,不可改类型;可改显示名或删除。",
        manual: "手动",
        readonly: "只读",
        perm: "权限(按角色)",
        permView: "谁能看",
        permEdit: "谁能改",
        permAll: "全部",
        permMember: "成员及以上",
        permAdmin: "仅管理员",
        permHint: "服务端强制:看不到的列连数据都不下发",
      }
    : {
        hint: "左でフィールド選択 → 右で名称 / 種類 / 選択肢 / 必須を編集;↑↓ で並び替え。",
        add: "フィールド追加",
        empty: "フィールドがありません",
        name: "名称",
        type: "種類",
        required: "必須フィールド",
        reqHint: "カード完了時に未入力なら「未補完」に",
        options: "選択肢",
        addOpt: "選択肢を追加",
        del: "フィールド削除",
        delConfirm: "削除しますか?データは消えます",
        derived: "派生列 · 読取専用",
        derivedHint: "値はカード / AI / keiri が自動算出。種類は変更不可;表示名変更と削除は可。",
        manual: "手動",
        readonly: "読取専用",
        perm: "権限(ロール別)",
        permView: "閲覧可",
        permEdit: "編集可",
        permAll: "全員",
        permMember: "メンバー以上",
        permAdmin: "管理者のみ",
        permHint: "サーバ強制:閲覧不可の列はデータも返さない",
      };

  const patchCol = useCallback(
    (cid: string, patch: Partial<TSmartColumn>) => {
      setCols((prev) => prev.map((x) => (x.id === cid ? { ...x, ...patch } : x)));
      smartTableService.updateColumn(ws, pid, table.id, cid, patch).catch(() => {});
    },
    [ws, pid, table.id]
  );

  const move = useCallback(
    (i: number, dir: -1 | 1) => {
      const j = i + dir;
      if (j < 0 || j >= cols.length) return;
      const re = [...cols];
      [re[i], re[j]] = [re[j], re[i]];
      setCols(re);
      void Promise.all(
        re.map((c, k) => smartTableService.updateColumn(ws, pid, table.id, c.id, { position: k }).catch(() => {}))
      );
    },
    [cols, ws, pid, table.id]
  );

  const addField = useCallback(async () => {
    const name = zh ? `字段 ${cols.length + 1}` : `Field ${cols.length + 1}`;
    const c = await smartTableService.addColumn(ws, pid, table.id, { name, type: "text" }).catch(() => null);
    if (c) {
      setCols((prev) => [...prev, c]);
      setSelectedId(c.id);
    }
  }, [cols.length, ws, pid, table.id, zh]);

  const deleteField = useCallback(() => {
    if (!sel) return;
    const cid = sel.id;
    setCols((prev) => {
      const next = prev.filter((x) => x.id !== cid);
      setSelectedId(next[0]?.id ?? null);
      return next;
    });
    smartTableService.deleteColumn(ws, pid, table.id, cid).catch(() => {});
  }, [sel, ws, pid, table.id]);

  const metaOf = (t: TSmartColumnType) => TYPE_META.find((m) => m.v === t);

  return (
    <div className="flex h-full min-h-0 bg-surface-1">
      {/* 左: 字段列表 */}
      <div className="flex w-72 shrink-0 flex-col border-r border-subtle bg-layer-1">
        <div className="border-b border-subtle px-3 py-2 text-11 leading-relaxed text-tertiary">{T.hint}</div>
        <div className="vertical-scrollbar flex-1 overflow-auto p-1.5">
          {cols.length === 0 && <div className="py-8 text-center text-13 text-tertiary">{T.empty}</div>}
          {cols.map((c, i) => {
            const M = metaOf(c.type);
            const Icon = M?.Icon ?? Sparkles;
            const isSel = c.id === selectedId;
            return (
              <div
                key={c.id}
                className={cn(
                  "group mb-0.5 flex items-center gap-1.5 rounded-sm pr-1.5",
                  isSel ? "bg-layer-2" : "hover:bg-layer-1-hover"
                )}
              >
                <div className="flex flex-col opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="flex h-3.5 w-5 items-center justify-center text-tertiary hover:text-secondary disabled:opacity-30"
                  >
                    <ChevronUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    disabled={i === cols.length - 1}
                    onClick={() => move(i, 1)}
                    className="flex h-3.5 w-5 items-center justify-center text-tertiary hover:text-secondary disabled:opacity-30"
                  >
                    <ChevronDown className="size-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className="flex min-w-0 grow items-center gap-2 py-1.5 text-left"
                >
                  <Icon className={cn("size-3.5 shrink-0", isSel ? "text-accent-primary" : "text-tertiary")} />
                  <span className={cn("truncate text-13", isSel ? "font-medium text-primary" : "text-secondary")}>
                    {c.name}
                  </span>
                  {c.required && <span className="shrink-0 text-danger-primary">*</span>}
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-10 text-placeholder">
                    {c.source !== "manual" && <Sparkles className="size-3 text-tertiary" />}
                    {zh ? M?.zh : M?.ja}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addField}
          className="flex items-center gap-1.5 border-t border-subtle px-4 py-2.5 text-13 font-medium text-accent-primary hover:bg-layer-1-hover"
        >
          <Plus className="size-4" /> {T.add}
        </button>
      </div>

      {/* 右: 选中字段编辑面板 */}
      <div className="vertical-scrollbar min-w-0 flex-1 overflow-auto">
        {!sel ? (
          <div className="flex h-full items-center justify-center text-13 text-tertiary">{T.empty}</div>
        ) : (
          <div className="mx-auto max-w-md px-6 py-6">
            {/* 名称 */}
            <div className="mb-1 text-11 font-semibold tracking-wide text-placeholder uppercase">{T.name}</div>
            <input
              value={nameDraft}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value)}
              onBlur={() => {
                const n = nameDraft.trim();
                if (n && n !== sel.name) patchCol(sel.id, { name: n });
              }}
              className="w-full rounded-md border border-subtle bg-surface-1 px-3 py-2 text-14 font-medium text-primary outline-none focus:border-accent-strong"
            />

            {sel.source === "manual" ? (
              <>
                {/* 类型: 图标+文字 网格 */}
                <div className="mt-5 mb-1 text-11 font-semibold tracking-wide text-placeholder uppercase">{T.type}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {TYPE_META.map(({ v, zh: z, ja, Icon }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => patchCol(sel.id, { type: v })}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2.5 py-2 text-13",
                        sel.type === v
                          ? "border-accent-strong bg-accent-subtle text-accent-primary"
                          : "border-subtle text-secondary hover:bg-layer-1-hover"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {zh ? z : ja}
                    </button>
                  ))}
                </div>

                {/* 必填 */}
                <label
                  htmlFor="col-required"
                  aria-label={T.required}
                  className="mt-5 flex cursor-pointer items-start gap-2.5"
                >
                  <input
                    id="col-required"
                    type="checkbox"
                    checked={sel.required}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => patchCol(sel.id, { required: e.target.checked })}
                    className="mt-0.5 size-4"
                  />
                  <span>
                    <span className="block text-13 text-primary">{T.required}</span>
                    <span className="block text-11 text-tertiary">{T.reqHint}</span>
                  </span>
                </label>

                {/* 选项(单选/多选) */}
                {SELECTABLE.has(sel.type) && (
                  <>
                    <div className="mt-5 mb-1.5 text-11 font-semibold tracking-wide text-placeholder uppercase">
                      {T.options}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-subtle p-2.5">
                      {(sel.options ?? []).map((o, i) => (
                        <span
                          key={o.v}
                          className="inline-flex items-center gap-1 rounded-full py-0.5 pr-1.5 pl-1"
                          style={{
                            background: (o.color || "#7a8088") + "26",
                            border: `1px solid ${(o.color || "#7a8088") + "55"}`,
                          }}
                        >
                          <button
                            type="button"
                            title={zh ? "换颜色" : "色を変更"}
                            onClick={() => {
                              const next = [...(sel.options ?? [])];
                              const ci = PALETTE.indexOf(o.color || "");
                              next[i] = { ...o, color: PALETTE[(ci + 1) % PALETTE.length] };
                              patchCol(sel.id, { options: next });
                            }}
                            className="size-3 shrink-0 rounded-full"
                            style={{ background: o.color || "#7a8088" }}
                          />
                          <input
                            value={o.v}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                              const next = [...(sel.options ?? [])];
                              next[i] = { ...o, v: e.target.value };
                              setCols((prev) => prev.map((x) => (x.id === sel.id ? { ...x, options: next } : x)));
                            }}
                            onBlur={() => patchCol(sel.id, { options: sel.options })}
                            className="w-20 bg-transparent text-12 outline-none"
                            style={{ color: o.color || undefined }}
                          />
                          <button
                            type="button"
                            onClick={() => patchCol(sel.id, { options: (sel.options ?? []).filter((_, j) => j !== i) })}
                            className="text-tertiary hover:text-danger-primary"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          patchCol(sel.id, {
                            options: [
                              ...(sel.options ?? []),
                              {
                                v: (zh ? "选项 " : "選択肢 ") + ((sel.options?.length ?? 0) + 1),
                                color: PALETTE[(sel.options?.length ?? 0) % PALETTE.length],
                              } as TSmartSelectOption,
                            ],
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-11 text-accent-primary hover:bg-accent-subtle"
                      >
                        <Plus className="size-3" /> {T.addOpt}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="mt-5 flex items-start gap-2 rounded-md bg-layer-2 px-3 py-2.5">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-tertiary" />
                <div>
                  <div className="text-13 font-medium text-secondary">{T.derived}</div>
                  <div className="mt-0.5 text-11 leading-relaxed text-tertiary">{T.derivedHint}</div>
                </div>
              </div>
            )}

            {/* 字段级权限(按角色, 服务端强制)。谁能看=所有列; 谁能改=仅 manual 列 */}
            <div className="mt-6 mb-1.5 text-11 font-semibold tracking-wide text-placeholder uppercase">{T.perm}</div>
            <div className="space-y-2 rounded-md border border-subtle p-2.5">
              {[
                { label: T.permView, field: "acl_view" as const, val: sel.acl_view ?? 0 },
                ...(sel.source === "manual"
                  ? [{ label: T.permEdit, field: "acl_edit" as const, val: sel.acl_edit ?? 0 }]
                  : []),
              ].map(({ label, field, val }) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-12 text-tertiary">{label}</span>
                  <div className="flex grow gap-0.5 rounded-md bg-layer-2 p-0.5">
                    {[
                      { v: 0, t: T.permAll },
                      { v: 15, t: T.permMember },
                      { v: 20, t: T.permAdmin },
                    ].map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => patchCol(sel.id, { [field]: o.v })}
                        className={cn(
                          "flex-1 rounded-sm px-1.5 py-1 text-12",
                          val === o.v
                            ? "bg-surface-1 font-medium text-primary shadow-raised-100"
                            : "text-secondary hover:text-primary"
                        )}
                      >
                        {o.t}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="text-11 leading-relaxed text-placeholder">{T.permHint}</div>
            </div>

            {/* 两段式删除 */}
            <div className="mt-8 border-t border-subtle pt-4">
              <button
                type="button"
                onClick={() => (confirmDel ? deleteField() : setConfirmDel(true))}
                onBlur={() => setConfirmDel(false)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-13 font-medium",
                  confirmDel ? "bg-danger-primary text-white" : "text-danger-primary hover:bg-danger-subtle"
                )}
              >
                <Trash2 className="size-4" />
                {confirmDel ? T.delConfirm : T.del}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
