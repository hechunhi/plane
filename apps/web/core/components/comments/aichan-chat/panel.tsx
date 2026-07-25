/**
 * BARSOUL 愛ちゃん私聊パネル(2026-07-25, hechun)
 *
 * なぜ「別チャンネル」なのか:
 *   コメント欄で愛ちゃんに頼むと、その依頼文が全員に飛ぶ。だから頼み事は
 *   **自分にしか見えない場所** でやる。文脈(どの課題か)はコメント欄の位置が
 *   そのまま与えてくれるので、場所はコメント欄のまま、可視性だけを private にする。
 *
 * 交互設計の芯 —— 「投稿されない」を常に見せる:
 *   ・ヘッダに常駐する「あなただけに表示」チップ(消えない)
 *   ・入力は素の textarea。@メンションも画像も **わざと** 無い。
 *     コメント欄と見た目が違うこと自体が「ここは別チャンネル」の合図。
 *   ・私聊 → 公開の橋は「コメントに引用」ただ一本。しかも *挿入* であって投稿ではない。
 *     送信を押すのは最後まで人間 —— ここが「全員に飛ぶのが怖い」への回答。
 *   ・空状態は無言にせず、文脈から決まる定型の切り出しを出す(下一步清晰 > 全自動)。
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  EyeOff,
  Loader2,
  MessageSquareQuote,
  RotateCw,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
// local
import { useAichanThread } from "./use-thread";
import type { TChatTurn } from "./use-thread";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  /** スラッシュ命令で `/愛ちゃん 〜` と後続語が打たれていれば、それを初期入力に。 */
  seed?: string;
  /** 課題名。「何を読んでいるか」を明示するためだけに使う。 */
  issueTitle?: string;
  onClose: () => void;
  /** 返答をコメント欄へ *挿入* する(投稿はしない)。 */
  onQuote: (text: string) => void;
  /** 返答を下敷きに審査を発起する。 */
  onEscalate: (text: string) => void;
};

const STARTERS = ["starter_summarize", "starter_draft_approval", "starter_next", "starter_reply"] as const;

export function AichanChatPanel(props: Props) {
  const { workspaceSlug, projectId, issueId, seed, issueTitle, onClose, onQuote, onEscalate } = props;
  const { t, currentLocale } = useTranslation();
  const lang = currentLocale === "ja" ? "ja" : currentLocale.startsWith("zh") ? "zh" : "en";

  const { turns, pending, error, send, retry, clear } = useAichanThread({ workspaceSlug, projectId, issueId, lang });
  const [draft, setDraft] = useState(seed ?? "");
  const [copiedAt, setCopiedAt] = useState(-1);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 開いたら即書ける。私聊は「思いついた瞬間」に使うものなので一手も無駄にしない。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 新しい発言・思考中表示が出たら末尾へ。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    void send(text);
  }, [draft, pending, send]);

  const copy = useCallback((text: string, index: number) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedAt(index);
      window.setTimeout(() => setCopiedAt(-1), 1500);
      return undefined;
    });
  }, []);

  const lastAssistantIndex = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "assistant") return i;
    return -1;
  }, [turns]);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-md border border-subtle bg-surface-1"
      onKeyDown={(e) => {
        // Esc = コメント欄に戻る。パネル内で完結させ、課題パネルまで伝播させない。
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        // 親(comment-create)は素の Enter をコメント送信として拾う。私聊の Enter が
        // そこへ届くと **意図しない投稿** になる —— 最も避けたい事故なので必ず止める。
        if (e.key === "Enter") e.stopPropagation();
      }}
    >
      {/* ── ヘッダ:ここが何であるかを、閉じるまで言い続ける ───────────────── */}
      <div className="flex items-center gap-2 border-b border-subtle bg-layer-1 px-3 py-2">
        <Sparkles className="size-3.5 shrink-0 text-tertiary" />
        <span className="text-13 font-medium text-primary">{t("aichan_chat.title")}</span>
        <span className="flex items-center gap-1 rounded-sm border border-subtle px-1.5 py-0.5 text-11 text-tertiary">
          <EyeOff className="size-3" />
          {t("aichan_chat.private_chip")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {turns.length > 0 && (
            <Tooltip tooltipContent={t("aichan_chat.clear")}>
              <button
                type="button"
                onClick={clear}
                aria-label={t("aichan_chat.clear")}
                className="grid size-6 place-items-center rounded text-tertiary transition-colors hover:bg-layer-2 hover:text-primary"
              >
                <Trash2 className="size-3.5" />
              </button>
            </Tooltip>
          )}
          <Tooltip tooltipContent={t("aichan_chat.close")}>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("aichan_chat.close")}
              className="grid size-6 place-items-center rounded text-tertiary transition-colors hover:bg-layer-2 hover:text-primary"
            >
              <X className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── 文脈の明示:何を読んだ上で答えているのかを隠さない ─────────────── */}
      {issueTitle && (
        <div className="truncate border-b border-subtle px-3 py-1.5 text-11 text-tertiary">
          {t("aichan_chat.context_line")}
          <span className="ml-1 text-secondary">{issueTitle}</span>
        </div>
      )}

      {/* ── 会話 ──────────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="max-h-[340px] min-h-[120px] overflow-y-auto px-3 py-3">
        {turns.length === 0 && !pending ? (
          <div className="flex flex-col gap-2">
            <p className="text-13 text-secondary">{t("aichan_chat.empty_title")}</p>
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((k) => {
                const label = t(`aichan_chat.${k}`);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => void send(label)}
                    className="rounded-full border border-subtle px-2.5 py-1 text-11 text-secondary transition-colors hover:border-strong hover:bg-layer-1 hover:text-primary"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <ChatTurn
                key={`${i}-${turn.role}`}
                turn={turn}
                showActions={turn.role === "assistant" && i === lastAssistantIndex}
                copied={copiedAt === i}
                onCopy={() => copy(turn.content, i)}
                onQuote={() => onQuote(turn.content)}
                onEscalate={() => onEscalate(turn.content)}
              />
            ))}
            {pending && (
              <div className="flex items-center gap-2 text-11 text-tertiary">
                <Loader2 className="size-3.5 animate-spin" />
                {t("aichan_chat.thinking")}
              </div>
            )}
          </div>
        )}

        {error && !pending && (
          <div className="mt-3 flex items-center gap-2 text-11 text-danger-primary">
            <span className="min-w-0 flex-1 truncate">{t("aichan_chat.err_generic")}</span>
            <button
              type="button"
              onClick={retry}
              className="flex shrink-0 items-center gap-1 rounded border border-subtle px-1.5 py-0.5 text-tertiary transition-colors hover:bg-layer-1 hover:text-primary"
            >
              <RotateCw className="size-3" />
              {t("aichan_chat.retry")}
            </button>
          </div>
        )}
      </div>

      {/* ── 入力:素の textarea。コメント欄と別物であることを形で示す ────────── */}
      <div className="flex items-end gap-2 border-t border-subtle px-3 py-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={t("aichan_chat.placeholder")}
          className="max-h-32 min-h-[32px] flex-1 resize-none bg-transparent py-1.5 text-13 text-primary outline-none placeholder:text-tertiary"
        />
        <Tooltip tooltipContent={t("aichan_chat.enter_hint")}>
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || pending}
            aria-label={t("aichan_chat.send")}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded transition-colors",
              draft.trim() && !pending
                ? "bg-accent-primary text-on-color hover:bg-accent-primary-hover"
                : "cursor-not-allowed text-tertiary"
            )}
          >
            <SendHorizontal className="size-3.5" />
          </button>
        </Tooltip>
      </div>

      <p className="border-t border-subtle px-3 py-1.5 text-11 text-tertiary">{t("aichan_chat.footer_note")}</p>
    </div>
  );
}

/* ── 1 ターン ───────────────────────────────────────────────────────────── */

type TurnProps = {
  turn: TChatTurn;
  showActions: boolean;
  copied: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onEscalate: () => void;
};

function ChatTurn({ turn, showActions, copied, onCopy, onQuote, onEscalate }: TurnProps) {
  const { t } = useTranslation();

  // 自分の発言 = 淡い塊。愛ちゃんの返答 = 素のテキスト + 左の印。
  // どちらも **コメントカードには似せない**(アバターも時刻も付けない) ——
  // 「これは投稿ではない」を形で分からせるため。
  if (turn.role === "user") {
    return (
      <div className="self-end rounded-md bg-layer-1 px-2.5 py-1.5 text-13 whitespace-pre-wrap text-primary">
        {turn.content}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-tertiary" />
      <div className="min-w-0 flex-1">
        <p className="text-13 leading-relaxed whitespace-pre-wrap text-secondary">{turn.content}</p>
        {showActions && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <TurnAction
              icon={copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              label={copied ? t("aichan_chat.copied") : t("aichan_chat.copy")}
              onClick={onCopy}
            />
            <TurnAction
              icon={<MessageSquareQuote className="size-3" />}
              label={t("aichan_chat.quote_to_comment")}
              onClick={onQuote}
            />
            <TurnAction icon={null} label={t("aichan_chat.to_approval")} onClick={onEscalate} />
          </div>
        )}
      </div>
    </div>
  );
}

function TurnAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-subtle px-1.5 py-0.5 text-11 text-tertiary transition-colors hover:bg-layer-1 hover:text-primary"
    >
      {icon}
      {label}
    </button>
  );
}
