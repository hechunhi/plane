/**
 * BARSOUL: 定期タスク 卡集成(IUTEYA-15) — 卡上「この作業を定期化」入口 + 卡顶「定期上下文条」。
 * 见 docs/architecture/recurring-tasks-mvp.md。
 * 入口与一览「新規」共用 RecurringRuleEditor(一组件一概念); 上下文条复用 flow-context 区位、Repeat 中性标(非琥珀非蓝)。
 */
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import {
  Repeat,
  ArrowRight,
  Clock,
  Calendar,
  X,
  AlarmClock,
  EyeOff,
  Eye,
  Bell,
  BellRing,
  User,
  Users,
  ChevronRight,
  ChevronDown,
  StickyNote,
  Moon,
  Sunrise,
  Settings2,
  Plus,
} from "lucide-react";
import { Button } from "@plane/propel/button";
import { Tooltip } from "@plane/propel/tooltip";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useZh, useIssueAIState, pick } from "@/components/issues/issue-layouts/kanban/ai-state-line";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import {
  recurringService,
  type TSnoozePreset,
  type TReminderInput,
  type TReminderIntensity,
  type TReminderAudience,
  type TSnoozeState,
} from "@/services/recurring.service";
import { RecurringRuleEditor } from "./recurring-editor";

type Props = { issueId: string; disabled?: boolean };

// 卡上「この作業を定期化」: 把当前卡快照成模板, 打开同一个编辑器(seed 预填)。
export const RecurrizeButton = observer(function RecurrizeButton({ issueId, disabled = false }: Props) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const issue = getIssueById(issueId);
  const pid = issue?.project_id;
  const [open, setOpen] = useState(false);
  if (!workspaceSlug || !pid || !issue) return null;
  return (
    <div role="presentation" onClick={(e) => e.stopPropagation()}>
      <div role="presentation" onClick={() => !disabled && setOpen(true)}>
        <Button variant="secondary" disabled={disabled} size="lg">
          <Repeat className="size-4" />
          <span className="text-body-xs-medium">{zh ? "定期化" : "定期化"}</span>
        </Button>
      </div>
      {open && (
        <RecurringRuleEditor
          ws={workspaceSlug}
          pid={pid}
          seed={{
            name: issue.name,
            assignee_id: issue.assignee_ids?.[0] ?? null,
            description_html: issue.description_html ?? undefined,
          }}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </div>
  );
});

// 提醒强度/受众的展示文案
function reminderMeta(
  zh: boolean,
  s: { intensity?: TReminderIntensity; audience?: TReminderAudience; hide?: boolean }
) {
  const inten = s.intensity === "daily" ? (zh ? "每天提醒" : "毎日") : zh ? "提醒一次" : "1回";
  const aud =
    s.audience === "members"
      ? zh
        ? "全员"
        : "全員"
      : s.audience === "assignees"
        ? zh
          ? "担当"
          : "担当"
        : zh
          ? "只我"
          : "自分";
  const vis = s.hide ? (zh ? "到点前隐藏" : "それまで非表示") : zh ? "保留可见" : "表示のまま";
  return { inten, aud, vis };
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mkDay = (add: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + add);
  return d;
};
const nextMon = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const a = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + a);
  return d;
};
const chipStyle = (active: boolean): CSSProperties => ({
  padding: "7px 11px",
  border: `1px solid ${active ? "#c8bdf3" : "#e3e5e9"}`,
  borderRadius: 8,
  background: active ? "#f6f3ff" : "#fff",
  color: active ? "#5b3fce" : "#33363c",
  fontSize: 12.5,
  fontWeight: active ? 600 : 500,
  fontFamily: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
});

// 全配置「リマインダー」对话框: 何时(日付+時刻 / 相对截止日提前) · 是否隐藏 · 强度 · 受众。
function ReminderDialog({
  ws,
  pid,
  issueId,
  hasDue,
  initial,
  initialNote,
  initialDate,
  onClose,
  onSaved,
}: {
  ws: string;
  pid: string;
  issueId: string;
  hasDue: boolean;
  initial?: TSnoozeState | null;
  initialNote?: string;
  initialDate?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const zh = useZh();
  // 快捷时间药丸(高频路径): 今晚(<18点才出)/明早/后天/下周一; 智能推荐项=initialDate 命中者(球在他人→后天)。
  const presets = [
    ...(new Date().getHours() < 18
      ? [{ k: "tonight", lbl: zh ? "今晚" : "今夜", sub: "18:00", d: ymd(new Date()), t: "18:00" }]
      : []),
    { k: "tmrw", lbl: zh ? "明早" : "明朝", sub: "09:00", d: ymd(mkDay(1)), t: "09:00" },
    { k: "d2", lbl: zh ? "后天" : "明後日", sub: "09:00", d: ymd(mkDay(2)), t: "09:00" },
    { k: "mon", lbl: zh ? "下周一" : "来週月", sub: "09:00", d: ymd(nextMon()), t: "09:00" },
  ];
  const recKey = presets.find((p) => p.d === initialDate)?.k;
  const tomorrow = ymd(mkDay(1));
  const [sel, setSel] = useState<string>(initial ? "custom" : (recKey ?? "tmrw"));
  const [mode, setMode] = useState<"date" | "lead">("date");
  const [date, setDate] = useState(initial?.at_date || initialDate || tomorrow);
  const [time, setTime] = useState(initial?.at_jst?.slice(11, 16) || "09:00");
  const [lead, setLead] = useState(1);
  const [hide, setHide] = useState(!!initial?.hide);
  const [intensity, setIntensity] = useState<TReminderIntensity>(initial?.intensity ?? "once");
  const [audience, setAudience] = useState<TReminderAudience>(initial?.audience ?? "self");
  const [note, setNote] = useState(initial?.note ?? initialNote ?? "");
  const [more, setMore] = useState(
    !!initial && (!!initial.hide || initial.intensity === "daily" || (initial.audience ?? "self") !== "self")
  );
  const [busy, setBusy] = useState(false);

  // 选中时刻的实时人读预览(月/日(周几) 时:分)
  const WD = zh ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] : ["日", "月", "火", "水", "木", "金", "土"];
  const preview = (() => {
    const d = new Date(`${date}T00:00:00`);
    return isNaN(d.getTime()) ? "—" : `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}） ${time}`;
  })();
  const pickPreset = (p: { k: string; d: string; t: string }) => {
    setSel(p.k);
    setDate(p.d);
    setTime(p.t);
    setMode("date");
  };

  const save = async () => {
    const body: TReminderInput = { time, hide, intensity, audience, note: note.trim() || undefined };
    if (mode === "lead" && hasDue) body.lead_days = lead;
    else body.until = date;
    setBusy(true);
    const r = await recurringService.setSnooze(ws, pid, issueId, body).catch(() => null);
    setBusy(false);
    if (!r?.set) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: zh ? "设置失败(请选未来时间)" : "設定失敗(未来の日時を)",
        message: "",
      });
      return;
    }
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: zh ? `已设提醒 · ${r.at_jst ?? ""}` : `リマインダー設定 · ${r.at_jst ?? ""}`,
      message: "",
    });
    void globalMutate(`SNOOZE:${issueId}`, r, { revalidate: false });
    onSaved();
  };

  const Seg = <T extends string>(opts: { v: T; label: string; Icon?: typeof Bell }[], val: T, set: (v: T) => void) => (
    <div className="flex items-center gap-0.5 rounded-md bg-layer-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => set(o.v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-12 font-medium",
            val === o.v ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary"
          )}
        >
          {o.Icon && <o.Icon className="size-3.5" />} {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        data-prevent-outside-click
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[24rem] rounded-lg bg-surface-1 p-5 shadow-overlay-200"
      >
        <div className="mb-4 flex items-center gap-2 text-14 font-medium text-primary">
          <AlarmClock className="size-4 text-accent-primary" /> {zh ? "设置提醒" : "リマインダー設定"}
        </div>

        {/* 何时(快捷药丸, 高频 hero): 一拍即设, 智能推荐项预选 */}
        <div className="mb-2 text-11 font-semibold tracking-wide text-placeholder uppercase">
          {zh ? "什么时候回来处理" : "いつ戻って対応"}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.k} type="button" onClick={() => pickPreset(p)} style={chipStyle(sel === p.k)}>
              {p.lbl}
              {p.sub && <span style={{ fontSize: 11, color: sel === p.k ? "#8c7be0" : "#9499a0" }}>{p.sub}</span>}
              {p.k === recKey && (
                <span
                  style={{
                    background: "#fbf0d3",
                    color: "#92700a",
                    fontSize: 11,
                    padding: "0 4px",
                    borderRadius: 4,
                    marginLeft: 1,
                  }}
                >
                  {zh ? "荐" : "推奨"}
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setSel("custom");
              setMode("date");
            }}
            style={chipStyle(sel === "custom")}
          >
            <Calendar className="size-3.5" />
            {zh ? "自定义" : "指定"}
          </button>
        </div>
        {sel === "custom" && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="grow rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-13 text-primary outline-none"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-13 text-primary outline-none"
            />
          </div>
        )}
        <div className="mt-2 flex items-center gap-1.5 text-12 text-accent-primary">
          <ArrowRight className="size-3.5 shrink-0" />
          {preview} {zh ? "提醒你" : "に通知"}
        </div>

        {/* 备忘(已按「下一步」预填, 可改) */}
        <div className="mt-4 mb-1.5 flex flex-wrap items-center gap-1.5 text-11 font-semibold tracking-wide text-placeholder uppercase">
          <StickyNote className="size-3" />
          {zh ? "提醒我做什么" : "やること"}
          <span className="font-normal tracking-normal text-placeholder normal-case">
            · {zh ? "已按下一步自动填, 可改" : "次アクション自動補完・編集可"}
          </span>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder={zh ? "到时提醒我做什么…" : "その時に何をするか…"}
          className="w-full rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-3 py-2 text-13 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
        />

        {/* 更多选项(默认收起): 隐藏此卡 / 频率 / 提醒谁 (+ 截止前N天 仅有期日卡) */}
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className="mt-3.5 flex items-center gap-1 text-12 font-medium text-secondary hover:text-primary"
        >
          <ChevronRight className={cn("size-4 transition-transform", more && "rotate-90")} />
          {zh ? "更多选项" : "詳細設定"}
          <span className="font-normal text-placeholder">
            {" "}
            · {zh ? "隐藏此卡 / 频率 / 提醒谁" : "非表示 / 強度 / 誰に"}
          </span>
        </button>
        {more && (
          <div className="mt-3 space-y-3.5 border-t border-subtle-1 pt-3.5">
            {hasDue && (
              <div>
                <div className="mb-1.5 text-11 font-semibold tracking-wide text-placeholder uppercase">
                  {zh ? "或按截止日" : "締切基準"}
                </div>
                <div className="flex items-center gap-2">
                  {Seg(
                    [
                      { v: "date", label: zh ? "指定时间" : "時間指定" },
                      { v: "lead", label: zh ? "截止前" : "締切前" },
                    ] as const,
                    mode,
                    setMode
                  )}
                  {mode === "lead" && (
                    <>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={lead}
                        onChange={(e) => setLead(Math.max(0, Number(e.target.value) || 0))}
                        className="w-16 rounded-md border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1 text-13 text-primary outline-none"
                      />{" "}
                      <span className="text-13 text-secondary">{zh ? "天前" : "日前"}</span>
                    </>
                  )}
                </div>
              </div>
            )}
            <label
              aria-label={zh ? "到点前从看板/列表隐藏卡片" : "それまでカードを一覧から隠す"}
              className="flex cursor-pointer items-start gap-2.5"
            >
              <input
                type="checkbox"
                checked={hide}
                onChange={(e) => setHide(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span className="text-12 leading-relaxed text-secondary">
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  {hide ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{" "}
                  {zh ? "到点前从看板/列表隐藏卡片" : "それまでカードを一覧から隠す"}
                </span>
                <span className="block text-placeholder">
                  {zh ? "不勾=保留可见, 仅顶部显示提醒(推荐, 不怕忘)" : "未チェック=表示のまま, 上部にバッジ(推奨)"}
                </span>
              </span>
            </label>
            <div>
              <div className="mb-1.5 text-11 font-semibold tracking-wide text-placeholder uppercase">
                {zh ? "提醒频率" : "強度"}
              </div>
              {Seg(
                [
                  { v: "once", label: zh ? "一次" : "1回", Icon: Bell },
                  { v: "daily", label: zh ? "每天直到完成" : "毎日(完了まで)", Icon: BellRing },
                ] as const,
                intensity,
                setIntensity
              )}
            </div>
            <div>
              <div className="mb-1.5 text-11 font-semibold tracking-wide text-placeholder uppercase">
                {zh ? "提醒谁" : "誰に"}
              </div>
              {Seg(
                [
                  { v: "self", label: zh ? "只我" : "自分", Icon: User },
                  { v: "assignees", label: zh ? "担当" : "担当", Icon: User },
                  { v: "members", label: zh ? "全员" : "全員", Icon: Users },
                ] as const,
                audience,
                setAudience
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-13 text-secondary hover:bg-layer-1-hover"
          >
            {zh ? "取消" : "キャンセル"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-md bg-accent-primary px-4 py-1.5 text-13 font-medium text-white hover:bg-accent-primary-hover disabled:opacity-50"
          >
            {busy ? "…" : zh ? "设定提醒" : "設定"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 卡上「あとで通知」: 快捷预设(无隐藏/一次/只我)+ 详细设置对话框。
export const SnoozeButton = observer(function SnoozeButton({
  issueId,
  disabled = false,
  compact = false,
}: Props & { compact?: boolean }) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const issue = getIssueById(issueId);
  const pid = issue?.project_id;
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!workspaceSlug || !pid || !issue) return null;
  const hasDue = !!issue.target_date;

  const presets: { v: TSnoozePreset; label: string }[] = [
    { v: "tomorrow", label: zh ? "明天 9:00" : "明日 9:00" },
    { v: "biz2", label: zh ? "2 个工作日后" : "2営業日後" },
    { v: "next_mon", label: zh ? "下周一" : "来週月曜" },
    { v: "week1", label: zh ? "1 周后" : "1週間後" },
  ];
  // 快捷预设 = 不隐藏 + 一次 + 只我(无黑洞)+ 备忘
  const quick = async (preset: TSnoozePreset) => {
    setBusy(true);
    const r = await recurringService
      .setSnooze(workspaceSlug, pid, issueId, {
        preset,
        hide: false,
        intensity: "once",
        audience: "self",
        note: note.trim() || undefined,
      })
      .catch(() => null);
    setBusy(false);
    setOpen(false);
    setNote("");
    if (!r?.set) {
      setToast({ type: TOAST_TYPE.ERROR, title: zh ? "设置失败" : "設定に失敗", message: "" });
      return;
    }
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: zh ? `已设提醒 · ${r.at_jst ?? ""}` : `リマインダー · ${r.at_jst ?? ""}`,
      message: r.note || (zh ? "卡片保留可见" : "表示のまま"),
    });
    void globalMutate(`SNOOZE:${issueId}`, r, { revalidate: false });
  };

  return (
    <div role="presentation" className="relative" onClick={(e) => e.stopPropagation()}>
      <div role="presentation" onClick={() => !disabled && setOpen((s) => !s)}>
        {compact ? (
          <button
            type="button"
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-md border border-subtle bg-surface-1 px-2.5 py-1.5 text-12 text-secondary transition-colors hover:border-accent-strong hover:text-accent-primary disabled:opacity-50"
          >
            <AlarmClock className="size-3.5 text-accent-primary" />
            {zh ? "稍后提醒我" : "あとでリマインド"}
          </button>
        ) : (
          <Button variant="secondary" disabled={disabled} size="lg">
            <AlarmClock className="size-4" />
            <span className="text-body-xs-medium">{zh ? "提醒我" : "リマインド"}</span>
          </Button>
        )}
      </div>
      {open && (
        <div
          role="presentation"
          data-prevent-outside-click
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-10 left-0 z-30 w-60 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1.5 shadow-overlay-200"
        >
          {/* 备忘(可选): 到时提醒我做什么 */}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder={zh ? "备忘(可选): 到时提醒我…" : "メモ(任意): その時に…"}
            className="mb-1 w-full rounded-sm border-[0.5px] border-subtle-1 bg-layer-2 px-2 py-1.5 text-12 text-primary outline-none placeholder:text-placeholder focus:border-accent-strong"
          />
          <div className="px-2 pt-0.5 pb-1 text-10 font-semibold tracking-wide text-placeholder uppercase">
            {zh ? "何时提醒" : "いつ"}
          </div>
          {presets.map((p) => (
            <button
              key={p.v}
              type="button"
              disabled={busy}
              onClick={() => void quick(p.v)}
              className="block w-full rounded-sm px-2 py-1.5 text-left text-13 text-secondary hover:bg-layer-transparent-hover disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
          <div className="my-1 border-t border-subtle" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setDlg(true);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-13 text-accent-primary hover:bg-layer-transparent-hover"
          >
            <Calendar className="size-3.5" /> {zh ? "详细设置(时刻/隐藏/强度/谁)…" : "詳細設定…"}
          </button>
        </div>
      )}
      {dlg && (
        <ReminderDialog
          ws={workspaceSlug}
          pid={pid}
          issueId={issueId}
          hasDue={hasDue}
          initialNote={note}
          onClose={() => setDlg(false)}
          onSaved={() => {
            setDlg(false);
            setNote("");
          }}
        />
      )}
    </div>
  );
});

// 卡顶「リマインダー」条: 显示时刻 + 隐藏/强度/受众 + 编辑/解除。snooze 的卡可经直链打开。
export const SnoozeBar = observer(function SnoozeBar({ issueId, projectId }: { issueId: string; projectId: string }) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const [dlg, setDlg] = useState(false);
  const { data, mutate } = useSWR(
    workspaceSlug && projectId && issueId ? `SNOOZE:${issueId}` : null,
    () => recurringService.getSnooze(workspaceSlug!, projectId, issueId),
    { dedupingInterval: 30_000 }
  );
  // 未设提醒 → 显眼可见的「稍后提醒我」入口(富 popover: 备忘+时间快捷+详细)。设了 → 状态条。
  if (!data?.set)
    return (
      <div className="mt-2">
        <SnoozeButton issueId={issueId} compact />
      </div>
    );
  const m = reminderMeta(zh, data);
  const release = async () => {
    await recurringService.clearSnooze(workspaceSlug!, projectId, issueId).catch(() => {});
    void mutate({ set: false }, { revalidate: false });
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-12">
      <AlarmClock className="size-3.5 shrink-0 text-accent-primary" />
      <span className="text-secondary">
        {zh ? "提醒" : "リマインダー"} · <span className="font-medium text-primary">{data.at_jst ?? data.at_date}</span>
        {data.note && (
          <span className="ml-1.5 inline-flex items-center gap-1 text-primary">
            <StickyNote className="size-3" />
            {data.note}
          </span>
        )}
        <span className="ml-1.5 text-tertiary">
          {m.inten} · {m.aud} · {m.vis}
        </span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setDlg(true)}
          className="rounded-sm px-1.5 py-0.5 text-11 text-tertiary hover:bg-layer-1-hover hover:text-secondary"
        >
          {zh ? "编辑" : "編集"}
        </button>
        <button
          type="button"
          onClick={() => void release()}
          className="flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-11 text-accent-primary hover:bg-accent-subtle"
        >
          <X className="size-3" /> {zh ? "解除" : "解除"}
        </button>
      </div>
      {dlg && workspaceSlug && (
        <ReminderDialog
          ws={workspaceSlug}
          pid={projectId}
          issueId={issueId}
          hasDue={false}
          initial={data}
          onClose={() => setDlg(false)}
          onSaved={() => {
            setDlg(false);
            void mutate();
          }}
        />
      )}
    </div>
  );
});

// 卡顶「定期上下文条」: 该卡是某规则的当前实例 → 显示规则 + 次回 + 回链。复用 flow-context 容器样式。
export const RecurringContextBar = observer(function RecurringContextBar({
  issueId,
  projectId,
}: {
  issueId: string;
  projectId: string;
}) {
  const zh = useZh();
  const { workspaceSlug } = useParams() as { workspaceSlug?: string };
  const { data } = useSWR(
    workspaceSlug && projectId && issueId ? `RECURRING_CTX:${issueId}` : null,
    () => recurringService.getIssueContext(workspaceSlug!, projectId, issueId),
    { dedupingInterval: 30_000 }
  );
  if (!data?.recurring || !data.rule) return null;
  const r = data.rule;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-12">
      <Repeat className="size-3.5 shrink-0 text-tertiary" />
      <span className="text-secondary">
        {zh ? "定期タスク" : "定期タスク"}
        <span className="font-medium text-primary">「{r.name}」</span>
        <span className="text-tertiary"> · {r.cadence_label}</span>
      </span>
      {r.next_due && r.period_label && (
        <span className="text-tertiary">
          {zh ? "次回" : "次回"} {r.period_label}({r.next_due.slice(5).replace("-", "/")})
        </span>
      )}
      <a
        href={`/${workspaceSlug}/projects/${projectId}/recurring`}
        className="ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-11 text-accent-primary hover:bg-accent-subtle"
      >
        {zh ? "ルールを開く" : "ルールを開く"} <ArrowRight className="size-3" />
      </a>
    </div>
  );
});

// ── リマインダー: 详情顶部动作栏的分体按钮(左闹钟=快捷预设菜单, 右箭头=完整弹窗)──
// 用户(2026-06-16): ①位置钉死动作栏稳定可寻 ②快捷含分钟/小时级(忙现在·怕忘) ③分体: 默认快捷+箭头更多。
// 到点触发已迁 Temporal 持久定时器(后端 ReminderWorkflow, 退役 Beat 轮询); 此处仅设/改/清(走 setSnooze)。
function QuickSection({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: ".06em",
        color: "#aaadb4",
        textTransform: "uppercase",
        padding: "8px 10px 3px",
      }}
    >
      {label}
    </div>
  );
}
function QuickRow({
  icon: Icon,
  label,
  time,
  rec,
  disabled,
  onClick,
  onDelete,
}: {
  icon: typeof Bell;
  label: string;
  time?: string;
  rec?: string;
  disabled?: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group flex w-full items-center rounded-md hover:bg-layer-1-hover">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left disabled:opacity-50"
      >
        <Icon className="size-4 shrink-0" style={{ color: "#8a8e98" }} />
        <span style={{ flex: 1, fontSize: 13.5, color: "#2f3136" }}>{label}</span>
        {time && <span style={{ fontSize: 12, color: "#a2a5ac" }}>{time}</span>}
        {rec && (
          <span
            style={{
              fontSize: 11,
              color: "#92700a",
              background: "#fbf0d3",
              borderRadius: 4,
              padding: "0 5px",
              marginLeft: 6,
            }}
          >
            {rec}
          </span>
        )}
      </button>
      {onDelete && (
        <button
          type="button"
          title="删除"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="mr-1 hidden shrink-0 rounded p-1 text-tertiary group-hover:block hover:text-secondary"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// 自定义相对时间预设(localStorage, 用户级 UI 偏好·非 SoR): 手动设过的「N 分/时后」存起反复用 + 可删。
const REL_PRESET_KEY = "barsoul.reminder.relPresets";
function loadRelPresets(): { mins: number; label: string }[] {
  try {
    const v = JSON.parse(localStorage.getItem(REL_PRESET_KEY) || "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.mins === "number" && p.mins > 0).slice(0, 8) : [];
  } catch {
    return [];
  }
}
function saveRelPresets(list: { mins: number; label: string }[]) {
  try {
    localStorage.setItem(REL_PRESET_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* noop */
  }
}
function relLabel(zh: boolean, mins: number): string {
  if (mins % 60 === 0) return zh ? `${mins / 60} 小时后` : `${mins / 60}時間後`;
  if (mins > 60)
    return zh ? `${Math.floor(mins / 60)} 小时 ${mins % 60} 分后` : `${Math.floor(mins / 60)}時間${mins % 60}分後`;
  return zh ? `${mins} 分钟后` : `${mins}分後`;
}

export const ReminderActionButton = observer(function ReminderActionButton({
  workspaceSlug,
  projectId,
  issueId,
  isMobile,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isMobile?: boolean;
}) {
  const zh = useZh();
  const [dlg, setDlg] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customs, setCustoms] = useState<{ mins: number; label: string }[]>(() => loadRelPresets());
  const [addOpen, setAddOpen] = useState(false);
  const [addN, setAddN] = useState("");
  const [addUnit, setAddUnit] = useState<"m" | "h">("m");
  const wrapRef = useRef<HTMLDivElement>(null);
  const { data, mutate } = useSWR(
    workspaceSlug && projectId && issueId ? `SNOOZE:${issueId}` : null,
    () => recurringService.getSnooze(workspaceSlug, projectId, issueId),
    { dedupingInterval: 30_000 }
  );
  // 智能预填(仅传给完整弹窗): 下一步→备忘; 球在他人→默认 +2 天、球在我→明天。
  const s = useIssueAIState(workspaceSlug, projectId, issueId);
  const _next = s ? (pick(s.next_action, zh) || "").trim() : "";
  const remindNote = _next ? (s?.ball === "OTHER" ? (zh ? `催办: ${_next}` : `催促: ${_next}`) : _next) : undefined;
  const remindDays = s?.ball === "OTHER" ? 2 : 1;
  const suggestDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + remindDays);
    return d.toISOString().slice(0, 10);
  })();
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menu]);
  if (!workspaceSlug) return null;
  const set = !!data?.set;

  const apply = async (body: TReminderInput) => {
    setBusy(true);
    const r = await recurringService.setSnooze(workspaceSlug, projectId, issueId, body).catch(() => null);
    setBusy(false);
    setMenu(false);
    if (!r?.set) {
      setToast({ type: TOAST_TYPE.ERROR, title: zh ? "设置失败" : "設定失敗", message: "" });
      return;
    }
    setToast({
      type: TOAST_TYPE.SUCCESS,
      title: `${zh ? "已设提醒" : "リマインダー"} · ${r.at_jst ?? ""}`,
      message: "",
    });
    void mutate(r, { revalidate: false });
  };
  const rel = (mins: number) => apply({ at: new Date(Date.now() + mins * 60000).toISOString() });
  const day = (d: Date, time: string) => apply({ until: ymd(d), time });
  const clearIt = async () => {
    setBusy(true);
    const r = await recurringService.clearSnooze(workspaceSlug, projectId, issueId).catch(() => null);
    setBusy(false);
    setMenu(false);
    if (r) {
      setToast({ type: TOAST_TYPE.SUCCESS, title: zh ? "已解除提醒" : "リマインダー解除", message: "" });
      void mutate({ set: false }, { revalidate: false });
    }
  };
  // 自定义相对时间: 记住(反复用) / 删除 / 新增并即设。
  const remember = (mins: number) =>
    setCustoms((prev) => {
      const next = [{ mins, label: relLabel(zh, mins) }, ...prev.filter((p) => p.mins !== mins)].slice(0, 8);
      saveRelPresets(next);
      return next;
    });
  const delCustom = (mins: number) =>
    setCustoms((prev) => {
      const next = prev.filter((p) => p.mins !== mins);
      saveRelPresets(next);
      return next;
    });
  const addCustom = () => {
    const n = parseInt(addN, 10);
    if (!n || n <= 0) return;
    const mins = addUnit === "h" ? n * 60 : n;
    remember(mins);
    setAddOpen(false);
    setAddN("");
    void rel(mins);
  };
  const showTonight = new Date().getHours() < 18;
  const tip = set
    ? `${zh ? "已设提醒" : "リマインダー"} · ${data?.at_jst?.slice(5) ?? ""}${data?.note ? ` · ${data.note}` : ""}`
    : zh
      ? "稍后提醒 — 选时间(含分钟/小时级)"
      : "あとでリマインド — 時間を選択";

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          border: `1px solid ${set ? "#c8bdf3" : "#d9d9e0"}`,
          borderRadius: 7,
          overflow: "hidden",
        }}
      >
        <Tooltip tooltipContent={tip} isMobile={isMobile}>
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            style={{
              height: 28,
              padding: "0 9px",
              border: "none",
              background: set ? "#f6f3ff" : "#fff",
              color: set ? "#5b3fce" : "#5b5f66",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11.5,
              fontWeight: 500,
            }}
          >
            <AlarmClock className="size-4" style={{ color: "#7c5cff" }} />
            {set && <span>{data?.at_jst?.slice(5)}</span>}
          </button>
        </Tooltip>
        <div style={{ width: 1, background: set ? "#d6c9f5" : "#e3e3ea" }} />
        <button
          type="button"
          title={zh ? "更多设置" : "詳細設定"}
          onClick={() => {
            setDlg(true);
            setMenu(false);
          }}
          style={{
            width: 22,
            border: "none",
            background: set ? "#f6f3ff" : "#fff",
            color: "#9499a0",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronDown className="size-3.5" />
        </button>
      </div>
      {menu && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 50,
            width: 250,
            background: "#fff",
            border: "1px solid #ececf1",
            borderRadius: 11,
            boxShadow: "0 12px 34px rgba(26,23,42,.16)",
            padding: 5,
            fontFamily: "inherit",
          }}
        >
          {set && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "7px 9px 9px",
                borderBottom: "1px solid #f1f1f4",
                marginBottom: 2,
              }}
            >
              <AlarmClock className="size-4 shrink-0" style={{ color: "#7c5cff" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: "#2f3136", fontWeight: 500 }}>
                  {(zh ? "已设 · " : "設定済 · ") + (data?.at_jst?.slice(5) ?? "")}
                </div>
                {data?.note && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9094a0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {data.note}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={clearIt}
                title={zh ? "解除" : "解除"}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "#a2a5ac",
                  display: "inline-flex",
                  padding: 2,
                }}
              >
                <X className="size-4" />
              </button>
            </div>
          )}
          <QuickSection label={set ? (zh ? "改成" : "変更") : zh ? "今天处理" : "今日中"} />
          <QuickRow icon={Clock} label={zh ? "30 分钟后" : "30分後"} disabled={busy} onClick={() => rel(30)} />
          <QuickRow
            icon={Clock}
            label={zh ? "1 小时后" : "1時間後"}
            rec={zh ? "荐" : "推奨"}
            disabled={busy}
            onClick={() => rel(60)}
          />
          <QuickRow icon={Clock} label={zh ? "2 小时后" : "2時間後"} disabled={busy} onClick={() => rel(120)} />
          <QuickRow icon={Clock} label={zh ? "3 小时后" : "3時間後"} disabled={busy} onClick={() => rel(180)} />
          {customs.length > 0 && (
            <>
              <QuickSection label={zh ? "我的常用" : "よく使う"} />
              {customs.map((p) => (
                <QuickRow
                  key={p.mins}
                  icon={Clock}
                  label={p.label}
                  disabled={busy}
                  onClick={() => rel(p.mins)}
                  onDelete={() => delCustom(p.mins)}
                />
              ))}
            </>
          )}
          {addOpen ? (
            <div
              role="presentation"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 4px 10px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="number"
                min={1}
                value={addN}
                onChange={(e) => setAddN(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCustom();
                }}
                placeholder={zh ? "数" : "数"}
                style={{
                  width: 48,
                  border: "1px solid #e3e5e9",
                  borderRadius: 6,
                  padding: "5px 7px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <div style={{ display: "inline-flex", border: "1px solid #e3e5e9", borderRadius: 6, overflow: "hidden" }}>
                {(["m", "h"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setAddUnit(u)}
                    style={{
                      padding: "5px 9px",
                      border: "none",
                      background: addUnit === u ? "#f6f3ff" : "#fff",
                      color: addUnit === u ? "#5b3fce" : "#71757c",
                      fontSize: 12,
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    {u === "m" ? (zh ? "分钟" : "分") : zh ? "小时" : "時"}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 12.5, color: "#71757c" }}>{zh ? "后" : "後"}</span>
              <button
                type="button"
                onClick={addCustom}
                style={{
                  marginLeft: "auto",
                  height: 28,
                  padding: "0 11px",
                  border: "none",
                  borderRadius: 6,
                  background: "#7c5cff",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {zh ? "设定" : "設定"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-layer-1-hover"
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "#7c5cff",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            >
              <Plus className="size-4 shrink-0" style={{ color: "#7c5cff" }} />
              {zh ? "自定义相对时间…" : "相対時間を指定…"}
            </button>
          )}
          {!set && (
            <>
              <div style={{ height: 1, background: "#f1f1f4", margin: "4px 8px" }} />
              <QuickSection label={zh ? "之后" : "その後"} />
              {showTonight && (
                <QuickRow
                  icon={Moon}
                  label={zh ? "今晚" : "今夜"}
                  time="18:00"
                  disabled={busy}
                  onClick={() => day(mkDay(0), "18:00")}
                />
              )}
              <QuickRow
                icon={Sunrise}
                label={zh ? "明天上午" : "明日午前"}
                time="09:00"
                disabled={busy}
                onClick={() => day(mkDay(1), "09:00")}
              />
              <QuickRow
                icon={Calendar}
                label={zh ? "后天" : "明後日"}
                time="09:00"
                disabled={busy}
                onClick={() => day(mkDay(2), "09:00")}
              />
              <QuickRow
                icon={Calendar}
                label={zh ? "下周一" : "来週月"}
                disabled={busy}
                onClick={() => day(nextMon(), "09:00")}
              />
            </>
          )}
          <div style={{ height: 1, background: "#f1f1f4", margin: "4px 8px" }} />
          <button
            type="button"
            onClick={() => {
              setDlg(true);
              setMenu(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-layer-1-hover"
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "#5b5f66",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            <Settings2 className="size-4 shrink-0" style={{ color: "#9094a0" }} />
            {set ? (zh ? "修改详情" : "詳細を編集") : zh ? "自定义 / 更多设置…" : "指定 / 詳細…"}
          </button>
        </div>
      )}
      {dlg && (
        <ReminderDialog
          ws={workspaceSlug}
          pid={projectId}
          issueId={issueId}
          hasDue={false}
          initial={set ? data : null}
          initialNote={set ? undefined : remindNote}
          initialDate={set ? undefined : suggestDate}
          onClose={() => setDlg(false)}
          onSaved={() => {
            setDlg(false);
            void mutate();
          }}
        />
      )}
    </div>
  );
});
