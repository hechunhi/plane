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
 *
 * 2026-10-06(hechun「窓が窮屈」「途中で他へ移ったら？後台モードは？」):
 *   ・高さは上端ドラッグで変更(既定 min(520px, 55vh)、ダブルクリックで既定へ、localStorage)。
 *   ・「大きく表示」で右側ドロワーへ(portal。左端ドラッグで幅、手機は全画面)。
 *   ・返答待ちは jobs.ts の後台 job。閉じても / 別ページへ移っても続き、届けば右下 dock が知らせる。
 *     だから待ち行に「裏で続ける」(= 閉じる)を出し、閉じてよいことを言葉で示す。
 *   ・入力途中の下書きは課題ごとに保持(閉じて開き直しても消えない)。
 *
 * 2026-10-06(hechun「評論区 @愛ちゃん と同じことを。@ が多いと噪音 → だから私聊を作った」):
 *   私聊は「話すだけ」ではなく **@愛ちゃん と同じことができる** 必要がある。差は依頼文が出ないことだけ。
 *   ・自分の最後の発言に「実行」: @愛ちゃん と同じパイプライン(カード/審査/発送登録…)。
 *     依頼文はコメントにならず、公開が目的の結果だけが出る。ただの回答はここに返る。
 *   ・愛ちゃんの返答に「愛ちゃん名義で送る」: 催促・連絡の下書きを本物の @ 付きで投稿。
 *     宛先は本文の名前から既定選択 → 人が確かめて押す。投稿には「誰の依頼か」が必ず付く。
 *   どちらも 1 段の確認を挟む(公開になる操作なので、押し間違いで飛ばない)。
 */
"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  EyeOff,
  GripHorizontal,
  GripVertical,
  Loader2,
  Maximize2,
  Megaphone,
  MessageSquareQuote,
  Minimize2,
  MoonStar,
  RotateCw,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
// local
import { markPanelOpen } from "./jobs";
import { useAichanThread } from "./use-thread";
import type { TChatTurn, TPostCandidate } from "./use-thread";

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

const HEIGHT_KEY = "barsoul.aichan.panel-h";
const WIDTH_KEY = "barsoul.aichan.panel-w";
const EXPANDED_KEY = "barsoul.aichan.panel-expanded";
const draftKey = (issueId: string) => `barsoul.aichan.draft:${issueId}`;

const defaultHeight = () => Math.round(Math.min(520, window.innerHeight * 0.55));
const clampHeight = (h: number) => Math.round(Math.max(240, Math.min(h, window.innerHeight * 0.85)));
const DEFAULT_WIDTH = 480;
const clampWidth = (w: number) => Math.round(Math.max(360, Math.min(w, window.innerWidth * 0.95, 1100)));

const readNum = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const writeStr = (key: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
};

/** ポインタで 1 軸のサイズを変える。sign = ドラッグ方向とサイズ増減の向き(上へ/左へで大きくなるなら -1)。 */
function useDragSize(opts: {
  size: number;
  setSize: (n: number) => void;
  clamp: (n: number) => number;
  axis: "x" | "y";
  sign: 1 | -1;
  storageKey: string;
}) {
  const { size, setSize, clamp, axis, sign, storageKey } = opts;
  const drag = useRef<{ start: number; base: number; last: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { start: axis === "y" ? e.clientY : e.clientX, base: size, last: size };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const pos = axis === "y" ? e.clientY : e.clientX;
      d.last = clamp(d.base + sign * (pos - d.start));
      setSize(d.last);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      writeStr(storageKey, String(d.last));
    },
  };
}

const useIsMobile = () => {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
};

export function AichanChatPanel(props: Props) {
  const { workspaceSlug, projectId, issueId, seed, issueTitle, onClose, onQuote, onEscalate } = props;
  const { t, currentLocale } = useTranslation();
  const lang = currentLocale === "ja" ? "ja" : currentLocale.startsWith("zh") ? "zh" : "en";

  const { turns, pending, pendingKind, elapsedSec, error, send, act, postCandidates, postAs, retry, clear, cancel } =
    useAichanThread({
      workspaceSlug,
      projectId,
      issueId,
      issueTitle,
      lang,
    });
  // 下書き: seed があればそれ、無ければ前回書きかけ。
  const [draft, setDraft] = useState(() => {
    if (seed) return seed;
    try {
      return localStorage.getItem(draftKey(issueId)) ?? "";
    } catch {
      return "";
    }
  });
  const [copiedAt, setCopiedAt] = useState(-1);
  const [cancelled, setCancelled] = useState(false);
  /** 「実行」の確認を出している user 発言の index(-1 = 出していない)。 */
  const [confirmActAt, setConfirmActAt] = useState(-1);
  /** 「愛ちゃん名義で送る」を開いている assistant 返答の index。 */
  const [postAt, setPostAt] = useState(-1);
  /** 送り済みの返答(同じ返答を二度送らせない。課題を移ればリセット)。 */
  const [postedAt, setPostedAt] = useState<number[]>([]);
  useEffect(() => {
    setConfirmActAt(-1);
    setPostAt(-1);
    setPostedAt([]);
  }, [issueId]);

  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [height, setHeight] = useState(() => clampHeight(readNum(HEIGHT_KEY) ?? defaultHeight()));
  const [width, setWidth] = useState(() => clampWidth(readNum(WIDTH_KEY) ?? DEFAULT_WIDTH));

  const heightDrag = useDragSize({
    size: height,
    setSize: setHeight,
    clamp: clampHeight,
    axis: "y",
    sign: -1, // 上へ引くと高くなる
    storageKey: HEIGHT_KEY,
  });
  const widthDrag = useDragSize({
    size: width,
    setSize: setWidth,
    clamp: clampWidth,
    axis: "x",
    sign: -1, // 左へ引くと広くなる
    storageKey: WIDTH_KEY,
  });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // このパネルが開いている間は、返答はここに出る(dock では知らせない)。
  useEffect(() => {
    markPanelOpen(issueId, true);
    return () => markPanelOpen(issueId, false);
  }, [issueId]);

  // 開いたら即書ける。私聊は「思いついた瞬間」に使うものなので一手も無駄にしない。
  useEffect(() => {
    inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    writeStr(draftKey(issueId), draft ? draft : null);
  }, [draft, issueId]);

  // 入力欄は内容に合わせて伸びる(上限まで。超えたら中でスクロール)。
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, expanded ? 280 : 160)}px`;
  }, [draft, expanded]);

  // 新しい発言・思考中表示が出たら末尾へ。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending, expanded]);

  useEffect(() => {
    if (pending) setCancelled(false);
  }, [pending]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    setCancelled(false);
    void send(text);
  }, [draft, pending, send]);

  const copy = useCallback((text: string, index: number) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedAt(index);
      window.setTimeout(() => setCopiedAt(-1), 1500);
      return undefined;
    });
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((v) => {
      writeStr(EXPANDED_KEY, v ? null : "1");
      return !v;
    });
  }, []);

  const lastAssistantIndex = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "assistant") return i;
    return -1;
  }, [turns]);
  const lastUserIndex = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user") return i;
    return -1;
  }, [turns]);

  const errorText =
    error === "lost"
      ? t("aichan_chat.err_lost")
      : error === "timeout"
        ? t("aichan_chat.err_timeout")
        : t("aichan_chat.err_generic");

  const headerButton = (label: string, onClick: () => void, icon: React.ReactNode) => (
    <Tooltip tooltipContent={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="grid size-6 place-items-center rounded text-tertiary transition-colors hover:bg-layer-2 hover:text-primary"
      >
        {icon}
      </button>
    </Tooltip>
  );

  const body = (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-surface-1",
        expanded ? "h-full w-full" : "relative rounded-md border border-subtle"
      )}
      style={expanded ? undefined : { height }}
      onKeyDown={(e) => {
        // Esc = コメント欄に戻る。パネル内で完結させ、課題パネルまで伝播させない。
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        // 親(comment-create)は素の Enter をコメント送信として拾う。私聊の Enter が
        // そこへ届くと **意図しない投稿** になる —— 最も避けたい事故なので必ず止める。
        // (portal でも React のイベントは React 木を親へ伝うので、ここで止める必要は同じ)
        if (e.key === "Enter") e.stopPropagation();
      }}
    >
      {/* ── 高さハンドル(インライン時のみ):上へ引くと高くなる ────────────── */}
      {!expanded && (
        <Tooltip tooltipContent={t("aichan_chat.resize_hint")}>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("aichan_chat.resize_hint")}
            {...heightDrag}
            onDoubleClick={() => {
              setHeight(clampHeight(defaultHeight()));
              writeStr(HEIGHT_KEY, null);
            }}
            className="flex h-2.5 shrink-0 cursor-row-resize touch-none items-center justify-center bg-layer-1 text-placeholder hover:text-secondary"
          >
            <GripHorizontal className="size-3" />
          </div>
        </Tooltip>
      )}

      {/* ── ヘッダ:ここが何であるかを、閉じるまで言い続ける ───────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-subtle bg-layer-1 px-3 py-2">
        <Sparkles className="size-3.5 shrink-0 text-tertiary" />
        <span className="text-13 font-medium text-primary">{t("aichan_chat.title")}</span>
        <span className="flex items-center gap-1 rounded-sm border border-subtle px-1.5 py-0.5 text-11 text-tertiary">
          <EyeOff className="size-3" />
          {t("aichan_chat.private_chip")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {turns.length > 0 && headerButton(t("aichan_chat.clear"), clear, <Trash2 className="size-3.5" />)}
          {headerButton(
            expanded ? t("aichan_chat.shrink") : t("aichan_chat.expand"),
            toggleExpanded,
            expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />
          )}
          {headerButton(t("aichan_chat.close"), onClose, <X className="size-3.5" />)}
        </div>
      </div>

      {/* ── 文脈の明示:何を読んだ上で答えているのかを隠さない ─────────────── */}
      {issueTitle && (
        <div className="shrink-0 truncate border-b border-subtle px-3 py-1.5 text-11 text-tertiary">
          {t("aichan_chat.context_line")}
          <span className="ml-1 text-secondary">{issueTitle}</span>
        </div>
      )}

      {/* ── 会話 ──────────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
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
              <div key={`${i}-${turn.role}`} className="flex flex-col gap-1.5">
                <ChatTurn
                  turn={turn}
                  showActions={turn.role === "assistant" && i === lastAssistantIndex}
                  canAct={turn.role === "user" && i === lastUserIndex && !pending && confirmActAt !== i}
                  posted={postedAt.includes(i)}
                  copied={copiedAt === i}
                  onCopy={() => copy(turn.content, i)}
                  onQuote={() => onQuote(turn.content)}
                  onEscalate={() => onEscalate(turn.content)}
                  onAct={() => setConfirmActAt(i)}
                  onPostAs={() => setPostAt(i)}
                />
                {confirmActAt === i && turn.role === "user" && (
                  <ActConfirm
                    onCancel={() => setConfirmActAt(-1)}
                    onRun={() => {
                      setConfirmActAt(-1);
                      setCancelled(false);
                      void act(turn.content);
                    }}
                  />
                )}
                {postAt === i && turn.role === "assistant" && (
                  <PostAsBox
                    text={turn.content}
                    loadCandidates={postCandidates}
                    onSend={postAs}
                    onCancel={() => setPostAt(-1)}
                    onDone={() => {
                      setPostAt(-1);
                      setPostedAt((v) => [...v, i]);
                    }}
                  />
                )}
              </div>
            ))}
            {pending && (
              <div className="flex flex-col gap-1.5 rounded-md border border-subtle px-2.5 py-2">
                <div className="flex items-center gap-2 text-11 text-secondary">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  <span className="tabular-nums">
                    {pendingKind === "act"
                      ? t("aichan_chat.acting_elapsed", { sec: elapsedSec })
                      : t("aichan_chat.thinking_elapsed", { sec: elapsedSec })}
                  </span>
                </div>
                <p className="text-11 text-tertiary">{t("aichan_chat.background_hint")}</p>
                <div className="flex flex-wrap items-center gap-1">
                  <TurnAction
                    icon={<MoonStar className="size-3" />}
                    label={t("aichan_chat.run_in_background")}
                    onClick={onClose}
                  />
                  <TurnAction
                    icon={<X className="size-3" />}
                    label={t("aichan_chat.cancel")}
                    onClick={() => {
                      cancel();
                      setCancelled(true);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {(error || cancelled) && !pending && (
          <div className="mt-3 flex items-center gap-2 text-11 text-danger-primary">
            <span className="min-w-0 flex-1 truncate">{error ? errorText : ""}</span>
            <button
              type="button"
              onClick={() => {
                setCancelled(false);
                retry();
              }}
              className="flex shrink-0 items-center gap-1 rounded border border-subtle px-1.5 py-0.5 text-tertiary transition-colors hover:bg-layer-1 hover:text-primary"
            >
              <RotateCw className="size-3" />
              {t("aichan_chat.retry")}
            </button>
          </div>
        )}
      </div>

      {/* ── 入力:素の textarea。コメント欄と別物であることを形で示す ────────── */}
      <div className="flex shrink-0 items-end gap-2 border-t border-subtle px-3 py-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // B-20: Safari 在 compositionend 之后还会补一发 keyCode 229 的 Enter(isComposing 已 false), 一并挡掉
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={t("aichan_chat.placeholder")}
          // 16px 未満だと iOS が聚焦時に拡大する(project_plane_mobile_pwa)
          className="min-h-[32px] flex-1 resize-none bg-transparent py-1.5 text-16 text-primary outline-none placeholder:text-tertiary md:text-13"
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

      <p className="shrink-0 border-t border-subtle px-3 py-1.5 text-11 text-tertiary">
        {t("aichan_chat.footer_note")}
      </p>
    </div>
  );

  if (!expanded) return body;

  // ドロワー: コメント欄は sticky(z-20)の中にあるので、fixed は body 直下へ逃がす。
  return createPortal(
    <div
      className={cn(
        "fixed z-[30] flex border-subtle shadow-overlay-200",
        isMobile ? "inset-0" : "inset-y-0 right-0 border-l"
      )}
      style={isMobile ? undefined : { width }}
    >
      {!isMobile && (
        <Tooltip tooltipContent={t("aichan_chat.resize_width_hint")}>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("aichan_chat.resize_width_hint")}
            {...widthDrag}
            onDoubleClick={() => {
              setWidth(clampWidth(DEFAULT_WIDTH));
              writeStr(WIDTH_KEY, null);
            }}
            className="flex w-2.5 shrink-0 cursor-col-resize touch-none items-center justify-center bg-layer-1 text-placeholder hover:text-secondary"
          >
            <GripVertical className="size-3" />
          </div>
        </Tooltip>
      )}
      <div className="min-w-0 flex-1">{body}</div>
    </div>,
    document.body
  );
}

/* ── 1 ターン ───────────────────────────────────────────────────────────── */

type TurnProps = {
  turn: TChatTurn;
  showActions: boolean;
  /** 自分の最後の発言にだけ「実行」を出す。 */
  canAct: boolean;
  posted: boolean;
  copied: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onEscalate: () => void;
  onAct: () => void;
  onPostAs: () => void;
};

function ChatTurn({
  turn,
  showActions,
  canAct,
  posted,
  copied,
  onCopy,
  onQuote,
  onEscalate,
  onAct,
  onPostAs,
}: TurnProps) {
  const { t } = useTranslation();

  // 自分の発言 = 淡い塊。愛ちゃんの返答 = 素のテキスト + 左の印。
  // どちらも **コメントカードには似せない**(アバターも時刻も付けない) ——
  // 「これは投稿ではない」を形で分からせるため。
  if (turn.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="rounded-md bg-layer-1 px-2.5 py-1.5 text-13 whitespace-pre-wrap text-primary">
          {turn.content}
        </div>
        {canAct && (
          <Tooltip tooltipContent={t("aichan_chat.act_hint")}>
            <span>
              <TurnAction icon={<Zap className="size-3" />} label={t("aichan_chat.act")} onClick={onAct} />
            </span>
          </Tooltip>
        )}
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
            {posted ? (
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-11 text-tertiary">
                <Check className="size-3" />
                {t("aichan_chat.post_as_done")}
              </span>
            ) : (
              <TurnAction icon={<Megaphone className="size-3" />} label={t("aichan_chat.post_as")} onClick={onPostAs} />
            )}
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

/* ── 公開になる操作の確認(押し間違いで飛ばないよう 1 段挟む) ─────────────── */

function ConfirmShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-md border border-subtle bg-layer-1 px-2.5 py-2">{children}</div>;
}

const primaryBtn =
  "flex items-center gap-1 rounded bg-accent-primary px-2 py-0.5 text-11 text-on-color transition-colors hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

function ActConfirm({ onRun, onCancel }: { onRun: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <ConfirmShell>
      <p className="text-11 leading-relaxed text-secondary">{t("aichan_chat.act_confirm")}</p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onRun} className={primaryBtn}>
          <Zap className="size-3" />
          {t("aichan_chat.act_run")}
        </button>
        <TurnAction icon={null} label={t("aichan_chat.cancel_action")} onClick={onCancel} />
      </div>
    </ConfirmShell>
  );
}

type TPostAsProps = {
  text: string;
  loadCandidates: (text: string) => Promise<TPostCandidate[]>;
  onSend: (text: string, mentionIds: string[]) => Promise<void>;
  onCancel: () => void;
  onDone: () => void;
};

function PostAsBox({ text, loadCandidates, onSend, onCancel, onDone }: TPostAsProps) {
  const { t } = useTranslation();
  const [cands, setCands] = useState<TPostCandidate[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    loadCandidates(text)
      .then((c) => {
        if (!alive) return undefined;
        setCands(c);
        setPicked(c.filter((x) => x.selected).map((x) => x.id));
        return undefined;
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : "failed");
      });
    return () => {
      alive = false;
    };
  }, [text, loadCandidates]);

  const toggle = (id: string) => setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const send = async () => {
    setSending(true);
    setErr("");
    try {
      await onSend(text, picked);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
      setSending(false);
    }
  };

  return (
    <ConfirmShell>
      <p className="text-11 leading-relaxed text-secondary">{t("aichan_chat.post_as_confirm")}</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-11 text-tertiary">{t("aichan_chat.post_as_to")}</span>
        {cands === null && !err && <Loader2 className="size-3 animate-spin text-tertiary" />}
        {cands?.map((c) => {
          const on = picked.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c.id)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-11 transition-colors",
                on
                  ? "border-accent-strong bg-accent-subtle text-accent-primary"
                  : "border-subtle text-tertiary hover:bg-layer-2 hover:text-primary"
              )}
            >
              @{c.name}
            </button>
          );
        })}
      </div>
      {cands !== null && picked.length === 0 && (
        <p className="text-11 text-tertiary">{t("aichan_chat.post_as_no_mention")}</p>
      )}
      {err && <p className="text-11 text-danger-primary">{t("aichan_chat.post_as_failed")}</p>}
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => void send()} disabled={sending || cands === null} className={primaryBtn}>
          {sending ? <Loader2 className="size-3 animate-spin" /> : <Megaphone className="size-3" />}
          {t("aichan_chat.post_as_send")}
        </button>
        <TurnAction icon={null} label={t("aichan_chat.cancel_action")} onClick={onCancel} />
      </div>
    </ConfirmShell>
  );
}
