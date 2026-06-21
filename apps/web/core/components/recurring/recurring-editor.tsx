/**
 * BARSOUL: 定期タスク 编辑器(picker)— 卡上「この作業を定期化」与一览「新規定期タスク」共用同一组件(IA 收敛: 一组件一概念)。
 * 见 docs/architecture/recurring-tasks-mvp.md §6 视觉规格。
 * 色彩铁律: 周期 chip 选中=accent 蓝(选择/位置); 提醒 Bell=琥珀仅 icon; 余皆中性。日期不在前端复算(单一真相源=后端)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Repeat, Calendar, Bell, User, ChevronRight, ChevronDown, Wand2 } from "lucide-react";
import { cn } from "@plane/utils";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useZh } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import {
  recurringService,
  type TRecurringRule,
  type TRecurringCadence,
  type TRecurringAnchor,
  type TRecurringInput,
} from "@/services/recurring.service";

type Props = {
  ws: string;
  pid: string;
  rule?: TRecurringRule | null; // 编辑既有
  seed?: { name?: string; assignee_id?: string | null; description_html?: string }; // 卡上定期化的预填(正文=首期生成基底)
  onClose: () => void;
  onSaved: (rule: TRecurringRule) => void;
};

const WEEK_JA = ["月", "火", "水", "木", "金", "土", "日"]; // isoweekday 1..7
const WEEK_ZH = ["一", "二", "三", "四", "五", "六", "日"];

const defaultAnchor = (cad: TRecurringCadence): TRecurringAnchor => {
  if (cad === "weekly") return { weekdays: [1] };
  if (cad === "monthly") return { mode: "eom" }; // 月末 = 最常见运营场景 + 避开「填31」边角
  if (cad === "quarterly") return { start_month: 1, mode: "eom" };
  return { month: 1, day: 1 };
};

export function RecurringRuleEditor({ ws, pid, rule, seed, onClose, onSaved }: Props) {
  const zh = useZh();
  const [name, setName] = useState(rule?.name ?? seed?.name ?? "");
  const [cadence, setCadence] = useState<TRecurringCadence>(rule?.cadence ?? "monthly");
  const [anchor, setAnchor] = useState<TRecurringAnchor>(rule?.anchor ?? defaultAnchor(rule?.cadence ?? "monthly"));
  const [assignee, setAssignee] = useState<string | null>(rule?.assignee?.id ?? seed?.assignee_id ?? null);
  const [leadDays, setLeadDays] = useState(rule?.lead_days ?? 0);
  const [advOpen, setAdvOpen] = useState((rule?.lead_days ?? 0) > 0);
  const [genPrompt, setGenPrompt] = useState(rule?.generation_prompt ?? "");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const T = useMemo(
    () =>
      zh
        ? {
            title: rule ? "定期タスクを編集" : "新規定期タスク",
            name: "タスク名",
            namePh: "出勤簿提出 / 家賃振込確認 …",
            weekly: "毎週",
            monthly: "毎月",
            quarterly: "四半期",
            yearly: "毎年",
            when: "いつ",
            day: "指定日",
            eom: "月末",
            bom: "月初",
            startM: "起算月",
            month: "月",
            assignee: "担当",
            unassigned: "空欄=未認領(チームで認領)",
            adv: "詳細設定",
            lead: "期日の",
            leadAfter: "日前に通知",
            save: rule ? "保存" : "作成",
            cancel: "キャンセル",
            req: "タスク名を入力してください",
          }
        : {
            title: rule ? "定期タスクを編集" : "新規定期タスク",
            name: "タスク名",
            namePh: "出勤簿提出 / 家賃振込確認 …",
            weekly: "毎週",
            monthly: "毎月",
            quarterly: "四半期",
            yearly: "毎年",
            when: "いつ",
            day: "指定日",
            eom: "月末",
            bom: "月初",
            startM: "起算月",
            month: "月",
            assignee: "担当",
            unassigned: "空欄=未認領(チームで認領)",
            adv: "詳細設定",
            lead: "期日の",
            leadAfter: "日前に通知",
            save: rule ? "保存" : "作成",
            cancel: "キャンセル",
            req: "タスク名を入力してください",
          },
    [zh, rule]
  );

  const week = zh ? WEEK_ZH : WEEK_JA;
  const cads: { v: TRecurringCadence; label: string }[] = useMemo(
    () => [
      { v: "weekly", label: T.weekly },
      { v: "monthly", label: T.monthly },
      { v: "quarterly", label: T.quarterly },
      { v: "yearly", label: T.yearly },
    ],
    [T]
  );

  const pickCadence = useCallback((c: TRecurringCadence) => {
    setCadence(c);
    setAnchor(defaultAnchor(c));
  }, []);

  const toggleWeekday = useCallback((d: number) => {
    setAnchor((a) => {
      const cur = new Set(a.weekdays ?? []);
      if (cur.has(d)) cur.delete(d);
      else cur.add(d);
      return { ...a, weekdays: [...cur].toSorted() };
    });
  }, []);

  const save = useCallback(async () => {
    if (!name.trim()) {
      setToast({ type: TOAST_TYPE.ERROR, title: T.req, message: "" });
      return;
    }
    setBusy(true);
    const payload: TRecurringInput = {
      name: name.trim(),
      cadence,
      anchor,
      lead_days: leadDays,
      assignee_id: assignee,
      generation_prompt: genPrompt.trim(),
      // 新建从卡定期化: 快照源卡正文做首期生成基底(编辑既有规则不覆盖既有 template)
      ...(!rule && seed?.description_html ? { template: { description_html: seed.description_html } } : {}),
    };
    const r = rule
      ? await recurringService.update(ws, pid, rule.id, payload).catch(() => null)
      : await recurringService.create(ws, pid, payload).catch(() => null);
    setBusy(false);
    if (!r) {
      setToast({ type: TOAST_TYPE.ERROR, title: zh ? "保存に失敗しました" : "保存に失敗しました", message: "" });
      return;
    }
    if (r.next_due)
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: zh
          ? `次回 ${r.next_due} に「${r.name}(${r.period_label})」を自動作成します`
          : `次回 ${r.next_due} に「${r.name}(${r.period_label})」を自動作成します`,
        message: "",
      });
    onSaved(r);
  }, [name, cadence, anchor, leadDays, assignee, genPrompt, seed, rule, ws, pid, zh, T, onSaved]);

  const chip = "rounded-sm px-3 py-1 text-12 font-medium transition-colors";
  const modePill = "flex-1 rounded-sm px-2.5 py-1 text-12 transition-colors"; // anchor 模式 pill(替原生 radio)
  const segOn = "bg-accent-subtle text-accent-primary"; // 选中=蓝(选择/位置, 铁律正用)
  const segOff = "text-secondary hover:bg-layer-1-hover";
  const numCls =
    "h-7 w-12 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 text-center text-12 text-primary outline-none focus:border-accent-strong";

  // 规则摘要(读时投影=下一步清晰; 不在前端算具体日期, 单一真相源=后端)
  const wk = zh ? ["一", "二", "三", "四", "五", "六", "日"] : ["月", "火", "水", "木", "金", "土", "日"];
  const summary = (() => {
    let s = "";
    if (cadence === "weekly") s = (zh ? "毎週 " : "毎週 ") + (anchor.weekdays ?? []).map((d) => wk[d - 1]).join("・");
    else if (cadence === "monthly")
      s =
        (zh ? "毎月 " : "毎月 ") +
        (anchor.mode === "eom" ? T.eom : anchor.mode === "bom" ? T.bom : `${anchor.day ?? 1}日`);
    else if (cadence === "quarterly")
      s =
        `${T.quarterly}(${anchor.start_month ?? 1}${T.month}〜) ` +
        (anchor.mode === "day" ? `${anchor.day ?? 1}日` : T.eom);
    else s = (zh ? "毎年 " : "毎年 ") + `${anchor.month ?? 1}/${anchor.day ?? 1}`;
    if (leadDays > 0) s += zh ? ` · ${leadDays}天前提醒` : ` · ${leadDays}日前に通知`;
    return s;
  })();

  if (typeof document === "undefined") return null;
  // createPortal → document.body: 逃出 peek 详情面板的 transform 祖先(否则 fixed 被困在 peek 框内, 和 peek 互撞)
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="presentation"
        className="max-h-[88vh] w-[28rem] max-w-full overflow-auto rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-4 shadow-overlay-200"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2 text-14 font-semibold text-primary">
          <Repeat className="size-4 text-tertiary" /> {T.title}
        </div>

        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={T.namePh}
          className="mb-3 w-full rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
        />

        {/* 周期 segmented(选中=蓝) */}
        <div className="mb-3 flex gap-1 rounded-md bg-layer-1 p-0.5">
          {cads.map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => pickCadence(c.v)}
              className={cn(chip, "flex-1", cadence === c.v ? segOn : segOff)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* anchor 细目 */}
        <div className="mb-3 rounded-md border-[0.5px] border-subtle-1 bg-layer-1 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-11 text-tertiary">
            <Calendar className="size-3.5" /> {T.when}
          </div>
          {cadence === "weekly" && (
            <div className="flex gap-1">
              {week.map((w, i) => {
                const d = i + 1;
                const on = (anchor.weekdays ?? []).includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleWeekday(d)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-12",
                      on ? "bg-accent-primary text-white" : "bg-layer-2 text-secondary hover:bg-layer-1-hover"
                    )}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          )}
          {cadence === "monthly" && (
            <div className="space-y-2">
              <div className="flex gap-0.5 rounded-md bg-layer-2 p-0.5">
                {(
                  [
                    ["eom", T.eom],
                    ["bom", T.bom],
                    ["day", T.day],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAnchor((a) => ({ ...a, mode, day: a.day ?? 1 }))}
                    className={cn(modePill, (anchor.mode ?? "eom") === mode ? segOn : segOff)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(anchor.mode ?? "eom") === "day" && (
                <div className="flex items-center gap-1.5 pl-0.5 text-12 text-secondary">
                  {zh ? "毎月" : "毎月"}
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={anchor.day ?? 1}
                    onChange={(e) =>
                      setAnchor((a) => ({
                        ...a,
                        mode: "day",
                        day: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                      }))
                    }
                    className={numCls}
                  />{" "}
                  {zh ? "日" : "日"}
                </div>
              )}
            </div>
          )}
          {cadence === "quarterly" && (
            <div className="space-y-2">
              <div className="flex gap-0.5 rounded-md bg-layer-2 p-0.5">
                {(
                  [
                    ["eom", T.eom],
                    ["day", T.day],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAnchor((a) => ({ ...a, mode, day: a.day ?? 1 }))}
                    className={cn(modePill, (anchor.mode ?? "eom") === mode ? segOn : segOff)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-0.5 text-12 text-secondary">
                <span className="flex items-center gap-1.5">
                  {T.startM}
                  <select
                    value={anchor.start_month ?? 1}
                    onChange={(e) => setAnchor((a) => ({ ...a, start_month: Number(e.target.value) }))}
                    className="h-7 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 px-1.5 text-12 text-primary outline-none focus:border-accent-strong"
                  >
                    {[1, 4, 7, 10].map((m) => (
                      <option key={m} value={m}>
                        {m}
                        {T.month}
                      </option>
                    ))}
                  </select>
                </span>
                {(anchor.mode ?? "eom") === "day" && (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={anchor.day ?? 1}
                      onChange={(e) => setAnchor((a) => ({ ...a, mode: "day", day: Number(e.target.value) || 1 }))}
                      className={numCls}
                    />{" "}
                    {zh ? "日" : "日"}
                  </span>
                )}
              </div>
            </div>
          )}
          {cadence === "yearly" && (
            <div className="flex items-center gap-2 pl-0.5 text-12 text-secondary">
              <select
                value={anchor.month ?? 1}
                onChange={(e) => setAnchor((a) => ({ ...a, month: Number(e.target.value) }))}
                className="h-7 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 px-1.5 text-12 text-primary outline-none focus:border-accent-strong"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {T.month}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={31}
                value={anchor.day ?? 1}
                onChange={(e) => setAnchor((a) => ({ ...a, day: Number(e.target.value) || 1 }))}
                className={numCls}
              />
              <span>{zh ? "日" : "日"}</span>
            </div>
          )}
        </div>

        {/* 担当(可空=未認領) */}
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-1.5 text-11 text-tertiary">
            <User className="size-3.5" /> {T.assignee}
          </div>
          <div className="rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-1.5 py-0.5">
            <MemberDropdown
              multiple={false}
              value={assignee}
              onChange={(v: string | null) => setAssignee(v)}
              projectId={pid}
              placeholder={T.unassigned}
              buttonVariant="transparent-with-text"
              buttonContainerClassName="w-full text-left h-7.5"
              className="w-full"
            />
          </div>
        </div>

        {/* BARSOUL: LLM 改写生成(可选) — 每期以上一张卡为基, 按此指示改写正文(结构不变) */}
        <div className="mb-3">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-11 text-tertiary">
            <Wand2 className="size-3.5" style={{ color: "#7c5cff" }} />
            {zh ? "每期自动改写(可选)" : "毎回 自動リライト(任意)"}
            <span className="text-placeholder">· {zh ? "以上一张卡为基, 套此指示" : "前回カードを基にこの指示で"}</span>
          </div>
          <textarea
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={zh ? "例:把正文里的日期换成本期 / 金额留空待填" : "例: 本文の日付を今期に / 金額は空欄に"}
            className="w-full rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
          />
        </div>

        {/* 詳細設定(提前 N 日前; 折叠, 默认 0) */}
        <button
          type="button"
          onClick={() => setAdvOpen((s) => !s)}
          className="mb-2 flex items-center gap-1 text-12 text-tertiary hover:text-secondary"
        >
          {advOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {T.adv}
        </button>
        {advOpen && (
          <div className="mb-3 flex items-center gap-2 pl-1 text-13 text-secondary">
            <Bell className="size-3.5 text-warning-secondary" /> {T.lead}
            <input
              type="number"
              min={0}
              max={60}
              value={leadDays}
              onChange={(e) => setLeadDays(Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
              className={numCls}
            />
            {T.leadAfter}
          </div>
        )}

        {/* 规则摘要(读时投影 → 一目了然) */}
        <div className="mt-1 mb-1 flex items-center gap-1.5 rounded-md bg-layer-1 px-2.5 py-1.5 text-12 text-secondary">
          <Repeat className="size-3.5 shrink-0 text-tertiary" />{" "}
          <span className="font-medium text-primary">{summary}</span>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover"
          >
            {T.cancel}
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void save()}
            className="rounded-md bg-accent-primary px-3.5 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50"
          >
            {busy ? "…" : T.save}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
