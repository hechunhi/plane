/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { observer } from "mobx-react";
import { useForm, Controller } from "react-hook-form";
import { CornerUpLeft, GripHorizontal, MessageSquare, X } from "lucide-react";
// plane imports
import { EIssueCommentAccessSpecifier } from "@plane/constants";
import { COMMENT_INTENT_EVENT, buildCommentSlashOptions } from "@plane/editor";
import type { EditorRefApi, TCommentIntentDetail } from "@plane/editor";
import { useTranslation } from "@plane/i18n";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
// BARSOUL 2026-06-06: 爱酱发起审批入口(评论框旁图标 → 表单, 替代评论区 @爱酱去污染)
// BARSOUL 2026-07-25: 斜杠命令 —— `/審査` は公開(全員に届く)、`/愛ちゃん` は私聊(自分だけ)
import { AichanApprovalButton } from "@/components/comments/aichan-approval-button";
import { AichanChatPanel, consumeReopen, subscribeJobs } from "@/components/comments/aichan-chat";
// BARSOUL コメント返信 A 案: 返信先の受け渡しは reply-context (設計背景もそこ)
import { useCommentQuotePreview } from "@/components/comments/card/reply-quote";
import { useCommentReply } from "@/components/comments/reply-context";
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import { FileService } from "@/services/file.service";

type TCommentCreate = {
  entityId: string;
  workspaceSlug: string;
  activityOperations: TCommentsOperations;
  showToolbarInitially?: boolean;
  projectId?: string;
  onSubmitCallback?: (elementId: string) => void;
  /** BARSOUL: 私聊パネルの「読んでいる文脈」表示用(任意)。 */
  entityTitle?: string;
  /**
   * B-21: 入力欄が一覧のどちら側にあるか。"bottom"(既定, 古い順)なら展開時に一覧を
   * 末尾までスクロールして直近のコメントを入力欄の真上に出す; "top"(新しい順)なら
   * 最新は既に入力欄の隣にあるのでスクロールしない。
   */
  placement?: "top" | "bottom";
};

/**
 * B-21(2026-09-18 hechun「評論框使用其实非常高频」): 入力欄は三段階で大きくなる。
 *   ① 収納 = 一行の細い帯(常に画面下端に張り付く。長い活動一覧の底まで探しに行かない)
 *   ② 半画面 = 帯を押すと開く。エディタ min-h 40vh + ツールバー ≒ 画面の半分
 *   ③ 全画面 = 半画面の右上ボタン(既存 B-7)
 * 自動で ① に戻るのは **中身が空のとき** だけ(Esc / 一覧側をクリック / 送信直後)。
 * 下書きがある限り勝手に畳まない —— 書きかけを隠すのは記事帳に逃げられる原因になる。
 */
const getScrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
};
// B-23(2026-09-18 hechun「低解像度の Windows ノートで使いづらくなる」): 半画面の高さは
//   固定 40vh をやめ、既定 10rem からドラッグで変え、この端末に覚える(localStorage)。
//   値は editor 本体の min-height(px)。ダブルクリックで既定に戻す。
const COMPOSER_HEIGHT_KEY = "barsoul-comment-composer-min-h";
const COMPOSER_HEIGHT_MIN = 64;
const readComposerHeight = (): number | null => {
  try {
    const v = Number(localStorage.getItem(COMPOSER_HEIGHT_KEY));
    return Number.isFinite(v) && v >= COMPOSER_HEIGHT_MIN ? v : null;
  } catch {
    return null;
  }
};
// ポータルに出る浮層(ツールバーの T ドロップダウン / メンション / ダイアログ)は「外側クリック」扱いにしない
const POPOVER_SELECTOR =
  '[role="menu"],[role="listbox"],[role="dialog"],[data-radix-popper-content-wrapper],.tippy-box';

/**
 * BARSOUL(2026-07-25 hechun「審査を一等市民に」): コメント欄スラッシュ命令の受け皿。
 *
 * 発端: 「審査はどこからでも発起したい。ただし毎回 @愛ちゃん するのは嫌だ」
 *   —— コメント欄は全員に届くので、**依頼という私的な行為** の場所としては誤り。
 *
 * だから二本立てにした。場所は同じコメント欄、違うのは **可視性** だけ:
 *   `/審査`   → 公開。既存の審査モーダル → Temporal(裁決の権威は不変)。
 *   `/愛ちゃん` → 私聊。自分にしか見えない。公開したくなったら明示的に引用する。
 *
 * 可視性は「入口の場所」ではなく「動作の意味」で決める —— これが芯。
 */
type TIntentState = { kind: "approval" | "aichan"; query: string } | null;

// services
const fileService = new FileService();

export const CommentCreate = observer(function CommentCreate(props: TCommentCreate) {
  const {
    workspaceSlug,
    entityId,
    activityOperations,
    showToolbarInitially = false,
    projectId,
    onSubmitCallback,
    entityTitle,
    placement = "bottom",
  } = props;
  const { t } = useTranslation();
  // BARSOUL: 今どのコメントに返そうとしているか(カードの返信ボタンから来る)。
  const { replyToId, setReplyToId } = useCommentReply();
  const replyPreview = useCommentQuotePreview(replyToId);
  // states
  const [uploadedAssetIds, setUploadedAssetIds] = useState<string[]>([]);
  // BARSOUL: スラッシュ命令で開いた意図(審査モーダル / 愛ちゃん私聊)
  const [intent, setIntent] = useState<TIntentState>(null);
  const [approvalSeed, setApprovalSeed] = useState("");
  // BARSOUL 2026-10-06: 右下 dock の札から戻ってきたら、私聊パネルを開き直す(返答はもうスレッドにある)。
  useEffect(() => {
    const check = () => {
      if (consumeReopen(entityId)) setIntent({ kind: "aichan", query: "" });
    };
    check();
    return subscribeJobs(check);
  }, [entityId]);
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // store hooks
  const workspaceStore = useWorkspace();
  // derived values
  const workspaceId = workspaceStore.getWorkspaceBySlug(workspaceSlug)?.id as string;
  // BARSOUL B-7 草稿自动保存: 未发送内容按 issue 存 localStorage, 切卡/刷新/误关不丢, 回来接着写。
  const draftKey = `barsoul-comment-draft:${entityId}`;
  const [initialDraft] = useState(() => {
    try {
      const d = localStorage.getItem(draftKey);
      return d && !isCommentEmpty(d) ? d : "<p></p>";
    } catch {
      return "<p></p>";
    }
  });
  // B-21 三段階: 下書きが残っていれば最初から半画面(書きかけを隠さない)
  const [expanded, setExpanded] = useState(initialDraft !== "<p></p>");
  // 展開が「人の操作」で起きたときだけフォーカス+スクロールする(下書き復元での自動展開では
  // 課題を開いた瞬間に入力欄へ飛ばされてしまう)。
  const pendingFocus = useRef(false);
  const expand = useCallback(() => {
    pendingFocus.current = true;
    setExpanded(true);
  }, []);
  // B-23: ドラッグで決めた半画面の高さ(null = 既定)。
  const [composerMinH, setComposerMinH] = useState<number | null>(readComposerHeight);
  const onResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const editorEl = rootRef.current?.querySelector<HTMLElement>(".editor-container");
      if (!editorEl) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = editorEl.getBoundingClientRect().height;
      // 入力欄が一覧の下(bottom)なら把手は上端 → 上へ引くほど大きく; 上(top)なら逆。
      const sign = placement === "bottom" ? -1 : 1;
      const maxH = Math.round(window.innerHeight * 0.8);
      let last = startH;
      const onMove = (ev: PointerEvent) => {
        last = Math.min(maxH, Math.max(COMPOSER_HEIGHT_MIN, Math.round(startH + sign * (ev.clientY - startY))));
        setComposerMinH(last);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        try {
          localStorage.setItem(COMPOSER_HEIGHT_KEY, String(last));
        } catch {
          /* localStorage 不可用时忽略 */
        }
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [placement]
  );
  const onResizeReset = useCallback(() => {
    setComposerMinH(null);
    try {
      localStorage.removeItem(COMPOSER_HEIGHT_KEY);
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, []);
  // form info
  const {
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting },
    reset,
  } = useForm<Partial<TIssueComment>>({
    defaultValues: {
      comment_html: initialDraft,
    },
  });

  const onSubmit = async (formData: Partial<TIssueComment>) => {
    try {
      // BARSOUL: 返信先はここで一度だけ載せる。以後の編集では付け替えない
      //   (backend も partial_update で parent を落とす) — 「何への返事か」は
      //   書いた瞬間の事実で、後から書き換わると読み手が騙される。
      const comment = await activityOperations.createComment(replyToId ? { ...formData, parent: replyToId } : formData);
      setReplyToId(undefined);
      if (comment?.id) onSubmitCallback?.(comment.id);
      // B-7: 发送成功 → 清草稿(否则下次进来又恢复已发出的内容)
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* localStorage 不可用时忽略 */
      }
      if (uploadedAssetIds.length > 0) {
        if (projectId) {
          await fileService.updateBulkProjectAssetsUploadStatus(workspaceSlug, projectId.toString(), entityId, {
            asset_ids: uploadedAssetIds,
          });
        } else {
          await fileService.updateBulkWorkspaceAssetsUploadStatus(workspaceSlug, entityId, {
            asset_ids: uploadedAssetIds,
          });
        }
        setUploadedAssetIds([]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      reset({
        comment_html: "<p></p>",
      });
      editorRef.current?.clearEditor();
      // B-21: 送信したら帯に戻す(直近のコメント = 自分の投稿が入力欄の真上に見える)
      setExpanded(false);
    }
  };

  const commentHTML = watch("comment_html");
  const isEmpty = isCommentEmpty(commentHTML ?? undefined);
  // B-22: 畳んだ帯に出す下書きの一行プレビュー(タグを剥いだ素の文字)
  const draftPreview = useMemo(
    () =>
      (commentHTML ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    [commentHTML]
  );

  // ── BARSOUL: スラッシュ命令 ─────────────────────────────────────────────
  // 項目は i18n 済みでアプリ側が組む(`@plane/editor` は文言も業務も知らない)。
  // 渡した 2 項目だけがメニューに出る —— 見出し/表/画像はコメント欄に出さない。
  const commentCommands = useMemo(
    () =>
      buildCommentSlashOptions({
        approval: {
          title: t("comment_commands.approval_title"),
          description: t("comment_commands.approval_desc"),
          searchTerms: ["審査", "審査を依頼", "承認", "approval", "approve", "review", "审批", "shinsa", "sp"],
        },
        aichan: {
          title: t("comment_commands.aichan_title"),
          description: t("comment_commands.aichan_desc"),
          searchTerms: ["愛ちゃん", "爱酱", "ai", "aichan", "ask", "相談", "咨询", "chat"],
        },
      }),
    [t]
  );

  // BARSOUL: 返信ボタンを押したら入力欄まで連れて行って、そのまま打てる状態にする
  //   (返信先を選んだのに画面のどこかで入力欄を探す、が起きない)。
  //   B-21: 帯の状態なら先に半画面へ。引用しているコメントを見ながら書けるよう、一覧は
  //   スクロールしない(expand 経由ではなく直接 setExpanded)。
  useEffect(() => {
    if (!replyToId) return;
    setExpanded(true);
    const raf = requestAnimationFrame(() => editorRef.current?.focus("end", { scrollIntoView: false }));
    return () => cancelAnimationFrame(raf);
  }, [replyToId]);

  // B-21: 帯 → 半画面(人の操作)。フォーカスを入れ、"bottom" 配置なら一覧を末尾まで送る。
  useEffect(() => {
    if (!expanded || !pendingFocus.current) return;
    pendingFocus.current = false;
    const raf = requestAnimationFrame(() => {
      editorRef.current?.focus("end", { scrollIntoView: false });
      if (placement !== "bottom") return;
      const sp = getScrollParent(rootRef.current);
      sp?.scrollTo({ top: sp.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [expanded, placement]);

  // B-21: 空のまま一覧側(同じスクロール容器の中で入力欄の外)を押したら帯に戻す。
  //   ポータル浮層(T ドロップダウン / メンション候補 / ダイアログ)と容器の外(サイド
  //   バー等)は対象外 —— 「一覧を読みに行った」クリックだけを畳む合図にする。
  const collapseArmed = expanded && isEmpty && !replyToId && !isSubmitting;
  useEffect(() => {
    if (!collapseArmed) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      const target = e.target as HTMLElement | null;
      if (!root || !target || root.contains(target)) return;
      if (target.closest(POPOVER_SELECTOR)) return;
      const sp = getScrollParent(root);
      if (sp && !sp.contains(target)) return;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [collapseArmed]);

  // 意図イベントはエディタ DOM から冒泡してくる。この受け皿が張られている
  // コンテナ = そのコメント欄の課題 —— DOM の入れ子がそのままスコープになるので
  // surfaceId もレジストリも要らない。
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onIntent = (e: Event) => {
      const detail = (e as CustomEvent<TCommentIntentDetail>).detail;
      if (!detail?.kind) return;
      // 審査モーダルは projectId 必須(ワークスペース直下のコメントでは出さない)。
      if (detail.kind === "approval" && !projectId) return;
      if (detail.kind === "approval") setApprovalSeed(detail.query);
      setIntent({ kind: detail.kind, query: detail.query });
    };
    node.addEventListener(COMMENT_INTENT_EVENT, onIntent);
    return () => node.removeEventListener(COMMENT_INTENT_EVENT, onIntent);
  }, [projectId]);

  // 私聊 → 公開の唯一の橋。**挿入するだけで投稿はしない** —— 送信を押すのは人間。
  const quoteToComment = useCallback((text: string) => {
    setIntent(null);
    const html = text
      .split("\n")
      .map((line) => `<p>${line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)}</p>`)
      .join("");
    editorRef.current?.insertText(html, true);
    editorRef.current?.focus("end", { scrollIntoView: true });
  }, []);

  // 私聊の返答をそのまま審査の下敷きにする(私聊→公開の、もう一つの明示的な出口)。
  const escalateToApproval = useCallback(
    (text: string) => {
      if (!projectId) return;
      setApprovalSeed(text);
      setIntent({ kind: "approval", query: text });
    },
    [projectId]
  );

  const isChatOpen = intent?.kind === "aichan" && !!projectId;

  // BARSOUL(2026-06-15): 评论框 z-[20] 浮于上方评论头像(z-[4])之上, 否则工具栏 T 下拉
  // (向上弹)被头像盖住。★关键真凶: 桌面必须 sm:relative 而非 sm:static —— z-index 对
  // position:static 无效, sm:static 会让 z-[20] 在桌面(sm+)完全失效, 头像 z-4 反盖下拉。
  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("issue.comments.resize")}
      title={t("issue.comments.resize")}
      onPointerDown={onResizeStart}
      onDoubleClick={onResizeReset}
      className="hidden h-3 cursor-row-resize touch-none items-center justify-center text-placeholder select-none hover:text-tertiary md:flex"
    >
      <GripHorizontal className="size-4" strokeWidth={2} />
    </div>
  );

  return (
    <div
      ref={rootRef}
      // B-20: 全屏撰写时 z 抬到 30, 压过移动端底部导航(z-[20]); 平时保持 20(见下方说明)
      // B-21: 桌面も sticky(旧 sm:relative は「常時大きな入力欄が内容を隠す」対策だったが、
      //   帯に畳めるようになったので不要)。z の理屈は上の 2026-06-15 注記のまま。
      className={cn("sticky bottom-0 z-[20] bg-surface-1 has-[[data-composer-fullscreen]]:z-[30]")}
      // B-23: ドラッグで決めた高さは CSS 変数で editor 本体(min-h / max-h)へ渡す
      style={composerMinH ? ({ "--composer-min-h": `${composerMinH}px` } as CSSProperties) : undefined}
      role="presentation"
      onKeyDown={(e) => {
        // Esc: 空なら帯へ(全画面中はエディタ側が全画面解除を担当するので二段跳びしない)
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
        if (rootRef.current?.querySelector("[data-composer-fullscreen]")) return;
        if (collapseArmed) setExpanded(false);
      }}
    >
      {/* B-20(2026-09-18): 这里原有一条 React onKeyDown Enter→提交的旁路, 它不认 IME
          组合状态(Safari 在 compositionend 后还会补一发 keyCode 229 的 Enter), 是
          「中/日文输入法选字回车把半截评论发出去」的真凶。发送统一走编辑器内的
          Mod-Enter(enter-key 扩展, ProseMirror 天然跳过组合中的按键), 此处不再监听。 */}
      {/* BARSOUL B-2p v2: 発起審査ボタンは快捷动作行(IssueDetailWidgetActionButtons)へ移設 — 動作入口の統一(用户点名) */}

      {/* BARSOUL 私聊: コメント欄と **入れ替える**。入力欄が同時に二つ出ないので
          「今どこに打っているのか」を迷わない ＝ 誤爆投稿が構造的に起きない。 */}
      {isChatOpen && projectId && (
        <AichanChatPanel
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={entityId}
          seed={intent?.query}
          issueTitle={entityTitle}
          onClose={() => {
            setIntent(null);
            editorRef.current?.focus("end", { scrollIntoView: false });
          }}
          onQuote={quoteToComment}
          onEscalate={escalateToApproval}
        />
      )}

      {/* BARSOUL 審査: 既存モーダルをそのまま受託(認可・Temporal は一切変えない)。 */}
      {projectId && (
        <AichanApprovalButton
          variant="controlled"
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={entityId}
          initialInstruction={approvalSeed}
          open={intent?.kind === "approval"}
          onClose={() => {
            setIntent(null);
            setApprovalSeed("");
          }}
        />
      )}

      {/* B-21 ① 収納帯。押すと半画面。エディタは下で hidden のまま生かしておく
          (アップロード途中 / undo 履歴 / 実例を捨てない)。 */}
      {!isChatOpen && !expanded && (
        <button
          type="button"
          onClick={expand}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm border border-subtle bg-surface-1 px-3 py-2 text-left text-13 text-placeholder transition-colors hover:border-strong hover:text-tertiary",
            // B-22: 下書きを抱えたまま畳んだ帯は「書きかけがある」と分かる字面にする
            !isEmpty && "text-secondary"
          )}
        >
          <MessageSquare className="size-4 shrink-0" strokeWidth={2} />
          {isEmpty ? (
            <span className="min-w-0 flex-1 truncate">{t("issue.comments.placeholder")}</span>
          ) : (
            <>
              <span className="shrink-0 rounded-sm bg-layer-2 px-1 text-[11px] text-tertiary">
                {t("issue.comments.draft")}
              </span>
              <span className="min-w-0 flex-1 truncate">{draftPreview || t("issue.comments.draft")}</span>
            </>
          )}
        </button>
      )}

      <div className={cn((isChatOpen || !expanded) && "hidden")}>
        {/* B-23 高さの把手(PC のみ)。bottom 配置は上端、top 配置は下端に出す。 */}
        {placement === "bottom" && resizeHandle}
        {/* BARSOUL: 「今これに返している」帯。カード上端の引用行と同じ字面
            (useCommentQuotePreview 共用) なので、投稿前と投稿後で見え方が変わらない。 */}
        {replyToId && (
          <div className="flex items-center gap-1.5 rounded-t border border-b-0 border-subtle bg-layer-2 px-2 py-1">
            <CornerUpLeft className="size-3 shrink-0 text-placeholder" strokeWidth={2} />
            {replyPreview.isDeleted ? (
              <span className="min-w-0 truncate text-[11px] text-placeholder italic">
                {t("issue.comments.reply.deleted")}
              </span>
            ) : (
              <>
                <span className="shrink-0 text-[11px] font-medium text-secondary">{replyPreview.authorName}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-tertiary">{replyPreview.quote}</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setReplyToId(undefined)}
              aria-label={t("issue.comments.reply.cancel")}
              className="shrink-0 rounded p-0.5 text-placeholder hover:bg-layer-3 hover:text-secondary max-md:-my-1 max-md:p-1.5"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </div>
        )}
        <Controller
          name="access"
          control={control}
          render={({ field: { onChange: onAccessChange, value: accessValue } }) => (
            <Controller
              name="comment_html"
              control={control}
              render={({ field: { value, onChange } }) => (
                <LiteTextEditor
                  editable
                  workspaceId={workspaceId}
                  id={"add_comment_" + entityId}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  onEnterKeyPress={(e) => {
                    if (!isEmpty && !isSubmitting) {
                      handleSubmit(onSubmit)(e);
                    }
                  }}
                  ref={editorRef}
                  initialValue={value ?? "<p></p>"}
                  // B-21 ② 半画面 → B-22/B-23: 固定 40vh はやめた。
                  //   スマホ: 3 行ぶんから中身に合わせて伸びる(上限は editor.tsx の 40dvh)。
                  //   PC: 既定 10rem、ドラッグで決めた高さ(--composer-min-h)があればそれ。
                  //   どちらも一覧を隠す面積は最小限から。
                  containerClassName="min-h-[5.5rem] md:min-h-[var(--composer-min-h,10rem)]"
                  isCollapsed={!expanded}
                  onCollapse={() => setExpanded(false)}
                  commentCommands={commentCommands}
                  onChange={(comment_json, comment_html) => {
                    onChange(comment_html);
                    // B-7 草稿: 非空存, 空则清(避免残留空草稿)
                    try {
                      if (comment_html && !isCommentEmpty(comment_html)) localStorage.setItem(draftKey, comment_html);
                      else localStorage.removeItem(draftKey);
                    } catch {
                      /* localStorage 不可用时忽略 */
                    }
                  }}
                  accessSpecifier={accessValue ?? EIssueCommentAccessSpecifier.INTERNAL}
                  handleAccessChange={onAccessChange}
                  isSubmitting={isSubmitting}
                  uploadFile={async (blockId, file) => {
                    const { asset_id } = await activityOperations.uploadCommentAsset(blockId, file);
                    setUploadedAssetIds((prev) => [...prev, asset_id]);
                    return asset_id;
                  }}
                  duplicateFile={async (assetId: string) => {
                    const { asset_id } = await activityOperations.duplicateCommentAsset(assetId);
                    setUploadedAssetIds((prev) => [...prev, asset_id]);
                    return asset_id;
                  }}
                  showToolbarInitially={showToolbarInitially}
                  parentClassName="p-2"
                  displayConfig={{
                    fontSize: "small-font",
                    lineSpacing: "compact",
                  }}
                />
              )}
            />
          )}
        />
        {placement === "top" && resizeHandle}
      </div>
    </div>
  );
});
