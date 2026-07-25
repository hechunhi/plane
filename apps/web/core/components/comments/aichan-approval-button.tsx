/**
 * BARSOUL 爱酱发起审批弹层 — v2 (2026-06-07, hechun)
 * - 打开即「爱酱分析」: 一次 analyze 产出 草稿 + 建议审批人 + 建议模式 + 风险标记 + 追问。
 *   人只做「采纳/微调」→ 充分使用爱酱能力, 不再是笨表单。
 * - 视觉打磨到 Plane 原生水准: header/body/footer 三段 + Avatar + accent 分析卡 +
 *   shimmer + segmented 模式(TabList) + alert 风成功态。
 * - 修浮层 bug: ModalCore portal 到 body → peek 面板 outside-click(mousedown)误把
 *   「点弹层」判成「点面板外」→ 收起 peek → 弹层随之消失。修法 = Plane 既有手法:
 *   内容根加 `data-prevent-outside-click`(+ onMouseDown stop)(见
 *   core/components/core/description-versions/modal.tsx)。
 * - 安全: 同源 Plane 认证代理 /ai-approval/, actor 服务端解析, 浏览器不持内部 token。
 * - 多语言: 全 t("aichan_approval.*")(zh-CN/zh-TW/ja/en 四语 parity)。
 */
"use client";

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { AlertCircle, AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, Zap } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Tooltip } from "@plane/propel/tooltip";
import { Avatar, EModalPosition, EModalWidth, Input, Loader, ModalCore, TabList, TextArea } from "@plane/ui";
// components
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
// hooks
import { useUser } from "@/hooks/store/user";
// BARSOUL: 審査カードの原子構成エディタ（2026-07-25）
import { ApprovalAtomComposer, pruneAtoms, type TAtom } from "./approval-atoms";

// B-2p v2: variant="widget" = 快捷动作行风格触发器(用户点名动作按钮统一进该行)
// B-5b: variant="controlled" = 触发器外置(发起流程下拉的「仅审批」项),open/onClose 受控
type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  variant?: "icon" | "widget" | "controlled";
  open?: boolean;
  onClose?: () => void;
  /**
   * BARSOUL(2026-07-25): 開くときの初期指示。`/審査 請求書の件` の後続語や、
   * 愛ちゃん私聊の返答をそのまま下敷きにする経路で使う。空なら従来どおり。
   */
  initialInstruction?: string;
};
type Mode = "ANY" | "ALL" | "SEQUENTIAL";

// 爱酱 sparkle(inline SVG, 不依赖图标包 → 零升级耦合/零 import 风险)
const Sparkle = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z" />
    <path d="M18.5 14l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
  </svg>
);

async function callAiApproval(ws: string, pid: string, iid: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/ai-approval/`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(body),
  });
  let j: any = {};
  try {
    j = await r.json();
  } catch {
    /* non-json */
  }
  if (!r.ok || !j?.ok) {
    const err = new Error(j?.error || j?.msg || "request failed");
    // Django が返す機械コード(例: need_other_approver)を呼び出し側に運ぶ。
    if (j?.code) (err as { code?: string }).code = j.code;
    throw err;
  }
  return j;
}

export const AichanApprovalButton = observer(function AichanApprovalButton(props: Props) {
  const { workspaceSlug, projectId, issueId, variant = "icon" } = props;
  const { t, currentLocale } = useTranslation();
  const { data: currentUser } = useUser();
  const lang = currentLocale === "ja" ? "ja" : "zh";

  // B-5b: controlled 変体は open を外(発起流程下拉)が持つ — modal が下拉の
  // unmount に巻き込まれない。それ以外は従来の内部 state。
  const isControlled = variant === "controlled";
  const [openState, setOpenState] = useState(false);
  const open = isControlled ? !!props.open : openState;
  const setOpen = (v: boolean) => {
    if (isControlled) {
      if (!v) props.onClose?.();
    } else setOpenState(v);
  };
  const [instruction, setInstruction] = useState("");
  const [subject, setSubject] = useState("");
  const [detail, setDetail] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("ANY");
  // 爱酱分析结果
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [suggestedApprovers, setSuggestedApprovers] = useState<string[]>([]);
  const [suggestedMode, setSuggestedMode] = useState<Mode | "">("");
  const [riskFlags, setRiskFlags] = useState<string[]>([]);
  const [riskNote, setRiskNote] = useState("");
  const [clarify, setClarify] = useState("");
  // BARSOUL: カード構成（原子列）。**開いて初めて**取りに行く（既定は従来の自動組成）。
  // 一度取ったら以後は必ず送る —— 見せた構成と実際のカードを食い違わせないため。
  const [atoms, setAtoms] = useState<TAtom[]>([]);
  const [atomsLoaded, setAtomsLoaded] = useState(false);
  const [atomsLoading, setAtomsLoading] = useState(false);
  const [atomsEdited, setAtomsEdited] = useState(false);
  // 提交
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [doneNo, setDoneNo] = useState("");

  const reset = () => {
    setInstruction("");
    setSubject("");
    setDetail("");
    setApprovers([]);
    setMode("ANY");
    setAnalyzing(false);
    setAnalyzed(false);
    setSuggestedApprovers([]);
    setSuggestedMode("");
    setRiskFlags([]);
    setRiskNote("");
    setClarify("");
    setAtoms([]);
    setAtomsLoaded(false);
    setAtomsLoading(false);
    setAtomsEdited(false);
    setSubmitting(false);
    setError("");
    setDoneNo("");
  };
  const close = () => {
    if (submitting || analyzing) return;
    setOpen(false);
    reset();
  };

  /**
   * BARSOUL: カード構成の提案を取りに行く（`action:"blocks"` = **読むだけ**、起票しない）。
   * 引数で subject/detail を渡すのは、直前の analyze の setState を待たないため。
   */
  const runBlocks = async (sub?: string, det?: string) => {
    const s = (sub ?? subject).trim();
    const d = (det ?? detail).trim();
    if (!s && !d) return;
    setAtomsLoading(true);
    try {
      const j = await callAiApproval(workspaceSlug, projectId, issueId, {
        action: "blocks",
        subject: s,
        detail: d,
        text: d || s,
      });
      const got = Array.isArray(j.blocks) ? (j.blocks as TAtom[]) : [];
      setAtoms(got);
      setAtomsLoaded(true);
      setAtomsEdited(false);
    } catch {
      // 構成は「あれば嬉しい」もの。取れなくても発起は止めない
      //（空のまま送らない = atomsLoaded を立てない → 従来の自動組成に戻る）。
      setAtomsLoaded(false);
    } finally {
      setAtomsLoading(false);
    }
  };

  const runAnalyze = async (textOverride?: string) => {
    setAnalyzing(true);
    setError("");
    try {
      const j = await callAiApproval(workspaceSlug, projectId, issueId, {
        action: "analyze",
        text: textOverride ?? instruction,
        lang,
      });
      if (j.subject) setSubject(j.subject);
      if (j.detail) setDetail(j.detail);
      const sa = (j.suggested_approver_ids || []) as string[];
      if (sa.length) {
        setApprovers(sa);
        setSuggestedApprovers(sa);
      }
      const sm = (j.suggested_mode || "") as string;
      if (sm === "ANY" || sm === "ALL" || sm === "SEQUENTIAL") {
        setMode(sm);
        setSuggestedMode(sm);
      }
      setRiskFlags((j.risk_flags || []) as string[]);
      setRiskNote(j.risk_note || "");
      setClarify(j.clarify || "");
      setAnalyzed(true);
      // 下敷きが書き変わったら構成も取り直す。ただし **人が触った構成は捨てない**
      //（自動更新が人の手を上書きするのは、この UI で一番やってはいけないこと）。
      if (atomsLoaded && !atomsEdited) void runBlocks(j.subject || "", j.detail || "");
    } catch {
      setError(t("aichan_approval.err_compose"));
      setAnalyzed(true); // 允许手动填写
    } finally {
      setAnalyzing(false);
    }
  };

  // 打开即分析(一次)。关闭→reset(analyzed=false)→下次打开重新分析。
  // BARSOUL: initialInstruction があれば **それを積んでから** 分析する
  // (setState は非同期なので instruction 経由ではなく直接渡す)。
  useEffect(() => {
    if (!open || analyzed || analyzing) return;
    const seed = (props.initialInstruction ?? "").trim();
    if (seed) setInstruction(seed);
    runAnalyze(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = async () => {
    setError("");
    if (!subject.trim()) {
      setError(t("aichan_approval.err_need_subject"));
      return;
    }
    if (approvers.length === 0) {
      setError(t("aichan_approval.err_need_approver"));
      return;
    }
    // 自己承認禁止(審批闸门): 発起人以外の審査者が最低1名必要。往復前に弾く。
    const uid = currentUser?.id ? String(currentUser.id) : "";
    if (uid && !approvers.some((a) => String(a) !== uid)) {
      setError(t("approval_inbox.err_need_other_approver"));
      return;
    }
    setSubmitting(true);
    try {
      // 構成を一度でも見た人には、**見たものをそのまま**焼く。
      // 一度も開いていなければ blocks を送らない → 従来どおり愛ちゃんが組む。
      const blocks = atomsLoaded ? pruneAtoms(atoms) : [];
      const j = await callAiApproval(workspaceSlug, projectId, issueId, {
        action: "invoke",
        subject,
        detail,
        text: detail || subject,
        approver_ids: approvers,
        mode,
        ...(blocks.length ? { blocks } : {}),
      });
      setDoneNo(j.no || "—");
    } catch (e: any) {
      // Django の機械コードは i18n メッセージへ翻訳(生の英文を出さない)。
      setError(
        e?.code === "need_other_approver"
          ? t("approval_inbox.err_need_other_approver")
          : e?.message || t("aichan_approval.err_generic")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const modeTabs = [
    {
      key: "ANY",
      label: (
        <span className="flex items-center justify-center gap-1">
          <Zap className="size-3" />
          {t("aichan_approval.mode_any_short")}
        </span>
      ),
    },
    {
      key: "ALL",
      label: (
        <span className="flex items-center justify-center gap-1">
          <CheckCheck className="size-3" />
          {t("aichan_approval.mode_all_short")}
        </span>
      ),
    },
    {
      key: "SEQUENTIAL",
      label: (
        <span className="flex items-center justify-center gap-1">
          <ArrowRight className="size-3" />
          {t("aichan_approval.mode_seq_short")}
        </span>
      ),
    },
  ];

  const riskLabel = (f: string) =>
    f === "money"
      ? t("aichan_approval.risk_money")
      : f === "irreversible"
        ? t("aichan_approval.risk_irreversible")
        : f === "batch"
          ? t("aichan_approval.risk_batch")
          : f;

  return (
    <>
      {isControlled ? null : variant === "widget" ? (
        // B-2p v2: 快捷动作行风格(对齐 IssueDetailWidgetButton = propel Button secondary lg)
        <div onClick={() => setOpen(true)}>
          <Button variant="secondary" size="lg">
            <Sparkle className="size-4" />
            <span className="text-body-xs-medium">{t("aichan_approval.button_tooltip")}</span>
          </Button>
        </div>
      ) : (
        <Tooltip tooltipContent={t("aichan_approval.button_tooltip")}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid aspect-square place-items-center rounded-xs p-1 text-placeholder transition-colors hover:bg-layer-1 hover:text-accent-primary"
            aria-label={t("aichan_approval.button_tooltip")}
          >
            <Sparkle className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}

      <ModalCore
        isOpen={open}
        handleClose={close}
        position={EModalPosition.CENTER}
        width={EModalWidth.XL}
        className="max-h-[90vh] overflow-hidden rounded-t-xl sm:rounded-lg"
      >
        {/* ★ bug 修复: 内容根标记 data-prevent-outside-click,阻止 peek 面板把点弹层当成点外部而收起 */}
        <div data-prevent-outside-click onMouseDown={(e) => e.stopPropagation()}>
          {doneNo ? (
            <>
              <div className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:items-start sm:text-left">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-success-subtle text-success-primary">
                  <CheckCircle2 className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-primary">
                    {t("aichan_approval.success", { no: doneNo })}
                  </h3>
                  <p className="text-sm mt-1 text-secondary">{t("aichan_approval.success_hint")}</p>
                </div>
              </div>
              <div className="flex justify-end border-t-[0.5px] border-subtle px-5 py-4">
                <Button variant="primary" onClick={close}>
                  {t("aichan_approval.done_btn")}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* ── header ── */}
              <div className="flex items-center gap-2.5 p-5">
                <Avatar name="愛" fallbackBackgroundColor="#028375" size="md" shape="circle" showTooltip={false} />
                <h3 className="text-base flex-1 font-semibold text-primary">{t("aichan_approval.modal_title")}</h3>
              </div>

              {/* ── body (scrollable) ── */}
              <div className="vertical-scrollbar scrollbar-sm max-h-[58vh] space-y-4 overflow-y-auto px-5">
                {/* 爱酱分析卡 */}
                <div className="border-accent-primary/20 rounded-md border bg-accent-primary/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm flex items-center gap-1.5 font-medium text-accent-primary">
                      <Sparkle className="size-3.5" /> {t("aichan_approval.draft_section_title")}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void runAnalyze()}
                      loading={analyzing}
                      disabled={analyzing || submitting}
                      className="text-accent-primary"
                    >
                      {t("aichan_approval.reanalyze")}
                    </Button>
                  </div>
                  <Input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder={t("aichan_approval.instruction_ph")}
                    className="text-sm mt-2 w-full bg-transparent"
                  />
                  {analyzing && (
                    <Loader className="mt-3 space-y-2">
                      <Loader.Item height="13px" width="45%" />
                      <Loader.Item height="12px" width="92%" />
                      <Loader.Item height="12px" width="70%" />
                    </Loader>
                  )}
                </div>

                {/* 风险 callout(命中才显示;amber 内联样式确保任何主题都渲染) */}
                {riskFlags.length > 0 && (
                  <div
                    className="text-sm flex gap-2 rounded-md border p-3"
                    style={{
                      borderColor: "rgba(245,158,11,0.35)",
                      backgroundColor: "rgba(245,158,11,0.10)",
                      color: "rgb(180,120,12)",
                    }}
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        {t("aichan_approval.risk_title")}
                        {riskFlags.map((f) => (
                          <span
                            key={f}
                            className="text-xs rounded-full px-2 py-0.5"
                            style={{ backgroundColor: "rgba(245,158,11,0.20)" }}
                          >
                            {riskLabel(f)}
                          </span>
                        ))}
                      </div>
                      {riskNote && <p className="text-xs opacity-90">{riskNote}</p>}
                      <p className="text-xs opacity-75">{t("aichan_approval.risk_hint")}</p>
                    </div>
                  </div>
                )}

                {/* clarify(爱酱想确认) */}
                {clarify && (
                  <div className="text-sm flex gap-2 rounded-md bg-layer-1 p-3 text-secondary">
                    <span aria-hidden>🤔</span>
                    <div>
                      <span className="font-medium">{t("aichan_approval.clarify_label")}: </span>
                      {clarify}
                    </div>
                  </div>
                )}

                {/* 主题 */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary">{t("aichan_approval.subject_label")}</label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t("aichan_approval.subject_ph")}
                    className="w-full"
                  />
                </div>

                {/* 详情 */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary">{t("aichan_approval.detail_label")}</label>
                  <TextArea
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    placeholder={t("aichan_approval.detail_ph")}
                    className="min-h-[80px] w-full resize-none"
                  />
                </div>

                {/* 审批人(爱酱建议预选) */}
                <div className="space-y-1.5">
                  <label className="text-sm flex items-center gap-1.5 font-medium text-secondary">
                    {t("aichan_approval.approvers_label")}
                    {suggestedApprovers.length > 0 && (
                      <span className="text-xs font-normal inline-flex items-center gap-0.5 rounded-full bg-accent-primary/10 px-1.5 py-0.5 text-accent-primary">
                        <Sparkle className="size-2.5" /> {t("aichan_approval.suggested_tag")}
                      </span>
                    )}
                  </label>
                  <MemberDropdown
                    projectId={projectId}
                    value={approvers}
                    onChange={(v: string[]) => setApprovers(v)}
                    multiple
                    buttonVariant="border-with-text"
                    buttonClassName="w-full justify-start"
                    placeholder={t("aichan_approval.approvers_ph")}
                  />
                </div>

                {/* 模式(segmented + 建议 + 一句说明) */}
                <div className="space-y-1.5">
                  <label className="text-sm flex items-center gap-1.5 font-medium text-secondary">
                    {t("aichan_approval.mode_label")}
                    {suggestedMode && (
                      <span className="text-xs font-normal inline-flex items-center gap-0.5 rounded-full bg-accent-primary/10 px-1.5 py-0.5 text-accent-primary">
                        <Sparkle className="size-2.5" /> {t("aichan_approval.suggested_tag")}
                      </span>
                    )}
                  </label>
                  {/* autoWrap 必须为 true(默认): TabList 内部 <Tab.List> 需要 <Tab.Group>
                      包裹; autoWrap=false 会缺父级 → 运行时崩。视觉选中由 selectedTab 驱动。 */}
                  <TabList tabs={modeTabs} selectedTab={mode} onTabChange={(k) => setMode(k as Mode)} size="md" />
                  <p className="text-xs text-tertiary">{t(`aichan_approval.mode_desc_${mode.toLowerCase()}`)}</p>
                </div>

                {/* BARSOUL: カード構成（既定は折り畳み。決裁の主役は上の 3 つ）。 */}
                <ApprovalAtomComposer
                  atoms={atoms}
                  onChange={(next) => {
                    setAtoms(next);
                    setAtomsEdited(true);
                  }}
                  onOpenChange={(isOpen) => {
                    if (isOpen && !atomsLoaded && !atomsLoading) void runBlocks();
                  }}
                  onRegenerate={() => void runBlocks()}
                  regenerating={atomsLoading}
                  edited={atomsEdited}
                  disabled={submitting}
                />
              </div>

              {/* ── error ── */}
              {error && (
                <div className="text-sm text-red-500 flex items-center gap-1.5 px-5 pt-3">
                  <AlertCircle className="size-4 shrink-0" /> <span>{error}</span>
                </div>
              )}

              {/* ── footer ── */}
              <div className="mt-4 flex flex-col-reverse gap-2 border-t-[0.5px] border-subtle px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
                <Button variant="secondary" onClick={close} disabled={submitting || analyzing}>
                  {t("aichan_approval.cancel_btn")}
                </Button>
                <Button
                  variant="primary"
                  onClick={onSubmit}
                  loading={submitting}
                  disabled={submitting || analyzing}
                  prependIcon={<Sparkle className="size-3.5" />}
                >
                  {submitting ? t("aichan_approval.submitting") : t("aichan_approval.submit_btn")}
                </Button>
              </div>
            </>
          )}
        </div>
      </ModalCore>
    </>
  );
});
