/**
 * BARSOUL 2026-07-25 (hechun「審査を一等市民に·独立発起」): 課題に紐づかない
 * **独立審査** の発起モーダル。審査受信箱(/{ws}/approvals)からだけ開く。
 *
 * なぜ要るか: 「請求書1本の承認」「社外公開1件のGO」等、課題化するまでもない
 * 頼み事も審査の一等市民。engine は工作项経路と **完全共有**(create_approval は
 * scope-generic; project_id/issue_id を送らなければ scope="独立")。裁決の権威は
 * Temporal のまま —— このモーダルは form を組んで invoke を叩くだけ、engine は触らない。
 *
 * 工作项版(comments/aichan-approval-button.tsx)との違いだけ:
 *   - 開いた瞬間の自動 analyze をしない(読む課題が無い)。人が自由文 → 任意で
 *     「愛ちゃんに下書き」ボタンで analyze。手入力だけでも発起できる。
 *   - 審査者は **ワークスペース成員**(MemberDropdown を projectId 無しで)。
 *   - 送信先は同源 Django 代理の workspace 経路(approvalsService.invoke)。actor は
 *     Django が session 解析(§X.3 可帰属; 前端は actor_id を送らない)。
 *
 * 色の約束(§UI 色彩语义): 琥珀 = リスク/行動信号のみ(analyze の risk callout)。
 * accent = 愛ちゃん下書きカード/選択。原子構成の検疫は ai-bot の
 * sanitize_content_blocks(LLM 経路と同一の唯一の関所)。
 */
"use client";

import { useState } from "react";
import { observer } from "mobx-react";
import { AlertCircle, AlertTriangle, ArrowRight, CheckCheck, CheckCircle2, Zap } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Avatar, EModalPosition, EModalWidth, Input, Loader, ModalCore, TabList, TextArea } from "@plane/ui";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { useUser } from "@/hooks/store/user";
import { ApprovalAtomComposer, pruneAtoms, type TAtom } from "@/components/comments/approval-atoms";
import { approvalsService } from "@/services/approvals.service";

type Mode = "ANY" | "ALL" | "SEQUENTIAL";

type Props = {
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
};

// 愛ちゃん sparkle(inline SVG, 図標包に依存しない)
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

export const StandaloneApprovalModal = observer(function StandaloneApprovalModal({
  workspaceSlug,
  isOpen,
  onClose,
  onCreated,
}: Props) {
  const { t, currentLocale } = useTranslation();
  const { data: currentUser } = useUser();
  const lang = currentLocale === "ja" ? "ja" : "zh";

  const [instruction, setInstruction] = useState("");
  const [subject, setSubject] = useState("");
  const [detail, setDetail] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("ANY");
  // 愛ちゃん解析(任意)。独立発起は自動起動しない —— 明示ボタンだけ。
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestedApprovers, setSuggestedApprovers] = useState<string[]>([]);
  const [suggestedMode, setSuggestedMode] = useState<Mode | "">("");
  const [riskFlags, setRiskFlags] = useState<string[]>([]);
  const [riskNote, setRiskNote] = useState("");
  const [clarify, setClarify] = useState("");
  // カード構成(原子列)。見せたら必ず送る = 見た構成と実カードを食い違わせない。
  const [atoms, setAtoms] = useState<TAtom[]>([]);
  const [atomsLoaded, setAtomsLoaded] = useState(false);
  const [atomsLoading, setAtomsLoading] = useState(false);
  const [atomsEdited, setAtomsEdited] = useState(false);
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
    reset();
    onClose();
  };

  // カード構成の提案(**読むだけ** — 起票しない)。subject/detail は setState を
  // 待たず引数で渡す。
  const runBlocks = async (sub?: string, det?: string) => {
    const s = (sub ?? subject).trim();
    const d = (det ?? detail).trim();
    if (!s && !d) return;
    setAtomsLoading(true);
    try {
      const got = await approvalsService.blocks(workspaceSlug, s, d);
      setAtoms(got as TAtom[]);
      setAtomsLoaded(true);
      setAtomsEdited(false);
    } catch {
      // 構成は「あれば嬉しい」もの。取れなくても発起は止めない。
      setAtomsLoaded(false);
    } finally {
      setAtomsLoading(false);
    }
  };

  const runAnalyze = async () => {
    const seed = instruction.trim();
    if (!seed) {
      setError(t("approval_inbox.need_instruction"));
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const j = await approvalsService.analyze(workspaceSlug, seed, lang);
      if (j.subject) setSubject(j.subject);
      if (j.detail) setDetail(j.detail);
      if (j.suggested_approver_ids.length) {
        setApprovers(j.suggested_approver_ids);
        setSuggestedApprovers(j.suggested_approver_ids);
      }
      if (j.suggested_mode === "ANY" || j.suggested_mode === "ALL" || j.suggested_mode === "SEQUENTIAL") {
        setMode(j.suggested_mode);
        setSuggestedMode(j.suggested_mode);
      }
      setRiskFlags(j.risk_flags);
      setRiskNote(j.risk_note);
      setClarify(j.clarify);
      // 下敷きが変わったら構成も取り直す(人が触った構成は上書きしない)。
      if (atomsLoaded && !atomsEdited) void runBlocks(j.subject || "", j.detail || "");
    } catch (e) {
      setError((e as { error?: string })?.error || t("aichan_approval.err_compose"));
    } finally {
      setAnalyzing(false);
    }
  };

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
      const blocks = atomsLoaded ? pruneAtoms(atoms) : [];
      const r = await approvalsService.invoke(workspaceSlug, {
        subject,
        detail,
        approver_ids: approvers,
        mode,
        ...(blocks.length ? { blocks } : {}),
      });
      if (r.ok) {
        setDoneNo(r.no || "—");
        onCreated();
      } else {
        setError(r.msg || t("aichan_approval.err_generic"));
      }
    } catch (e) {
      // Django の機械コードは i18n メッセージへ翻訳(生の英文を出さない)。
      const err = e as { error?: string; msg?: string; code?: string };
      setError(
        err?.code === "need_other_approver"
          ? t("approval_inbox.err_need_other_approver")
          : err?.error || t("aichan_approval.err_generic")
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
    <ModalCore
      isOpen={isOpen}
      handleClose={close}
      position={EModalPosition.CENTER}
      width={EModalWidth.XL}
      className="max-h-[90vh] overflow-hidden rounded-t-xl sm:rounded-lg"
    >
      <div data-prevent-outside-click onMouseDown={(e) => e.stopPropagation()}>
        {doneNo ? (
          <>
            <div className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:items-start sm:text-left">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-success-subtle text-success-primary">
                <CheckCircle2 className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-base font-semibold text-primary">{t("aichan_approval.success", { no: doneNo })}</h3>
                <p className="text-sm mt-1 text-secondary">{t("approval_inbox.new_success_hint")}</p>
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
              <div className="flex-1">
                <h3 className="text-base font-semibold text-primary">{t("approval_inbox.new_title")}</h3>
                <p className="text-xs text-tertiary">{t("approval_inbox.new_subtitle")}</p>
              </div>
            </div>

            {/* ── body (scrollable) ── */}
            <div className="vertical-scrollbar scrollbar-sm max-h-[58vh] space-y-4 overflow-y-auto px-5">
              {/* 愛ちゃん下書きカード(独立発起は明示ボタンで起動) */}
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
                    disabled={analyzing || submitting || !instruction.trim()}
                    className="text-accent-primary"
                  >
                    {t("approval_inbox.analyze_btn")}
                  </Button>
                </div>
                <Input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={t("approval_inbox.instruction_ph")}
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

              {/* 风险 callout(命中才显示; amber 内联样式确保任何主题都渲染) */}
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

              {/* clarify(愛ちゃん想确认) */}
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

              {/* 审批人(ワークスペース成員; projectId 無し) */}
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
                <TabList tabs={modeTabs} selectedTab={mode} onTabChange={(k) => setMode(k as Mode)} size="md" />
                <p className="text-xs text-tertiary">{t(`aichan_approval.mode_desc_${mode.toLowerCase()}`)}</p>
              </div>

              {/* カード構成(既定は折り畳み) */}
              <ApprovalAtomComposer
                atoms={atoms}
                onChange={(next) => {
                  setAtoms(next);
                  setAtomsEdited(true);
                }}
                onOpenChange={(open) => {
                  if (open && !atomsLoaded && !atomsLoading) void runBlocks();
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
  );
});
