/**
 * BARSOUL 週次ミーティング — 会議中の発言(双語) (hechun 2026-07-25)
 * 設計: docs/architecture/weekly-report-mvp.md 論点 4 / project_weekly_chat_module (P1)
 *
 * 週報(A)の双語トグルとは **意図的に違う出し方** をする:
 *   週報は「腰を据えて読む長文」なので、原文と訳文を切り替える。
 *   会議の発言は「テンポで流れる短文」なので、切り替えさせない —
 *   自分の言語を主、相手の言語を従として **同時に** 出す。
 *   日本語話者と中国語話者が同じ画面を見て、どちらも読める状態が既定。
 *
 * 発言は SoR(MeetingChatMessage)。訳文は派生キャッシュ(ContentTranslation)で、
 * 消えても原文は無傷 — 訳が無い発言は原文だけ出す(黙って落とさない)。
 *
 * P1: 発言単位の操作 — リアクション / 自分の発言の編集・取消。
 *   リアクションの絵文字は「UI アイコン」ではなく「中身のデータ」なので lucide 縛りの外。
 *   会期 OPEN の間だけ操作可(確定後は記録として固定 = readOnly)。
 */
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  ImagePlus,
  Loader,
  MessagesSquare,
  Pencil,
  Reply,
  SendHorizontal,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { observer } from "mobx-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Avatar } from "@plane/ui";
import { cn } from "@plane/utils";
import { peerSync, type PeerOp } from "@/components/core/peer-sync";
import { TranslateGlyph } from "@/components/issues/translate/issue-field-translate";
import { useUser } from "@/hooks/store/user";
import { storage } from "@/lib/local-storage";
import { registerTabBadge, unregisterTabBadge } from "@/lib/tab-badge";
import {
  weeklyService,
  type TMeetingChatMessage,
  type TMeetingChatReaction,
  type TMeetingChatReply,
} from "@/services/weekly.service";

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

/** 同一人物の連続発言はヘッダを省く。大画面で縦を食わないため。 */
const SAME_AUTHOR_WINDOW_MS = 4 * 60 * 1000;

/** よく使う相槌だけの小さな固定セット。絵文字ライブラリは会議のテンポには重い。 */
const QUICK_REACTIONS = ["👍", "✅", "🙏", "🎉", "😄", "❤️", "👀", "🤔"];

/** 既読位置は「その人のこの端末での見え方」= 派生。SoR には書かない(migration 不要)。 */
const readKey = (meetingId: string) => `weekly-chat-read:${meetingId}`;

/** タブバッジの登録キー。審批(priority 10)より右に出す。 */
const CHAT_BADGE_KEY = "weekly-chat";

const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** サーバ(assets v2)が受ける型と 5MB 上限に合わせる。手前で弾いて理由を出す方が親切。 */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 送信前の 1 枚。上げ切って asset_id が入るまで送信させない(半端な発言を作らない)。 */
type PendingImage = {
  preview: string; // objectURL(送信後 / 差し替え時に必ず revoke する)
  name: string;
  width: number;
  height: number;
  assetId: string | null;
  failed: boolean;
};

/** クリップボード / ドロップから画像ファイルを 1 枚だけ拾う。 */
const pickImage = (files: FileList | null | undefined): File | null =>
  Array.from(files || []).find((f) => f.type.startsWith("image/")) ?? null;

/**
 * 貼り付け原稿(求人票など)には空行が 3 連続で入っている事がある。
 * whitespace-pre-wrap はそれを全部出すので、22rem のドックでは巨大な余白になる。
 * **表示だけ** 2 行に詰める — SoR(原文)も編集欄(m.text 直読み)も触らない。
 */
const squeeze = (s: string) => (s || "").replace(/\n{3,}/g, "\n\n").trim();

/**
 * この文字数を超えたら畳む。
 * 発言は「テンポで流れる短文」の想定だが、実際には長文が来る — 双語で全展開すると
 * 1 発言で 1 画面を食い潰し、他の発言も composer も視界から消える
 * (実測: 原文 443 字 + 訳文 397 字 = 840 字 / 幅 22rem)。
 */
const LONG_TEXT_CHARS = 160;

/** 従言語が「訳文」なのか「原文」なのかは見る人の言語で入れ替わる — 記号を出し分ける為に持つ。 */
type Line = { primary: string; secondary: string | null; secondaryIsSource: boolean };

/**
 * 見る人の言語を主、もう片方を従にする。
 * 訳が無い(未検出・翻訳失敗)なら原文だけ — 空文字を出すより原文が正しい。
 */
function lines(m: TMeetingChatMessage, viewer: "ja" | "zh"): Line {
  const other = viewer === "ja" ? "zh" : "ja";
  const tr = m.translations || {};
  const src = squeeze(m.text);
  if (!m.source_lang) return { primary: src, secondary: null, secondaryIsSource: false };
  // 自分の言語で書かれた発言 → 主 = 原文、従 = 訳文。
  if (m.source_lang === viewer)
    return { primary: src, secondary: squeeze(tr[other] || "") || null, secondaryIsSource: false };
  // 相手の言語で書かれた発言 → 主 = 訳文、従 = **原文**。従に翻訳記号を付けると嘘になる。
  const mine = squeeze(tr[viewer] || "");
  return { primary: mine || src, secondary: mine ? src : null, secondaryIsSource: !!mine };
}

/** 引用チップは 1 行だけ — 見る人の言語で読める方を出す(主言語ロジックの縮約版)。 */
function quoteText(r: TMeetingChatReply, viewer: "ja" | "zh"): string {
  // 1 行に truncate するので改行は空白へ — pre-wrap でない場所に \n を渡すと詰まって見える。
  const flat = (s: string) => squeeze(s).replace(/\s*\n+\s*/g, " ");
  const txt = flat(r.text || "");
  if (!r.source_lang) return txt;
  if (r.source_lang === viewer) return txt;
  return flat((r.translations || {})[viewer] || "") || txt;
}

type Props = {
  workspaceSlug: string;
  meetingId: string;
  /** 確定済みの会期は発言も締める(記録として固定する)。 */
  readOnly?: boolean;
};

export const WeeklyChat = observer(function WeeklyChat({ workspaceSlug, meetingId, readOnly }: Props) {
  const { t, currentLocale } = useTranslation();
  const viewer: "ja" | "zh" = currentLocale === "ja" ? "ja" : "zh";
  const { data: currentUser } = useUser();
  const myId = currentUser?.id || "";

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // 発言単位の一過性 UI 状態(どれも 1 件だけ立つ)。
  const [activeId, setActiveId] = useState<string | null>(null); // タッチで操作列を出す対象
  const [pickerFor, setPickerFor] = useState<string | null>(null); // 絵文字パレットを開いている発言
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // 取消の確認を出している発言
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null); // 送信中の発言(二度押し防止)
  // 長文で畳んでいるものを開いた集合。既定は畳む(1 発言が画面を占領しないこと優先)。
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyingTo, setReplyingTo] = useState<TMeetingChatMessage | null>(null); // 引用返信の対象
  const [flashId, setFlashId] = useState<string | null>(null); // 引用元へ跳んだ時の一瞬のハイライト
  /**
   * 未読は 2 つの位置を分けて持つ:
   *   dividerAt = 開いた瞬間に凍結した線。読み進めても動かさない
   *               (読むそばから線が逃げると「どこから未読だったか」を失う)。
   *   lastReadRef = 実際の既読位置。読むたび進み、バッジ件数の基準になる。
   */
  const [dividerAt, setDividerAt] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pending, setPending] = useState<PendingImage | null>(null); // 送信待ちの画像(1 枚)
  const [dragOver, setDragOver] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pinnedRef = useRef(true);
  const lastReadRef = useRef<string>("");
  /** 上げている最中に別の画像を貼られたら、古い方の結果は捨てる。 */
  const uploadTokenRef = useRef(0);

  const { data, mutate } = useSWR(
    workspaceSlug && meetingId ? ["weekly-chat", workspaceSlug, meetingId] : null,
    () => weeklyService.chatList(workspaceSlug, meetingId)
  );
  const msgs = useMemo(() => data || [], [data]);

  /** 1 件足すだけ。全件再取得すると会議中に自分の入力位置が飛ぶ。 */
  const append = useCallback(
    (msg: TMeetingChatMessage) => {
      void mutate(
        (cur?: TMeetingChatMessage[]) => ((cur || []).some((x) => x.id === msg.id) ? cur : [...(cur || []), msg]),
        { revalidate: false }
      );
    },
    [mutate]
  );

  /** 既存の 1 件を差し替える(編集の実時反映)。無ければ何もしない。 */
  const replaceMsg = useCallback(
    (msg: TMeetingChatMessage) => {
      void mutate((cur?: TMeetingChatMessage[]) => (cur || []).map((x) => (x.id === msg.id ? { ...x, ...msg } : x)), {
        revalidate: false,
      });
    },
    [mutate]
  );

  /** 取消(ソフト削除)を一覧から外す。 */
  const removeMsg = useCallback(
    (id: string) => {
      void mutate((cur?: TMeetingChatMessage[]) => (cur || []).filter((x) => x.id !== id), { revalidate: false });
    },
    [mutate]
  );

  /** リアクション集計だけ差し替える(本文・訳文は触らない)。 */
  const setReactions = useCallback(
    (id: string, reactions: TMeetingChatReaction[]) => {
      void mutate((cur?: TMeetingChatMessage[]) => (cur || []).map((x) => (x.id === id ? { ...x, reactions } : x)), {
        revalidate: false,
      });
    },
    [mutate]
  );

  useEffect(() => {
    if (!meetingId) return;
    return peerSync.register("weekly", (op: PeerOp) => {
      if (String(op.meeting_id) !== meetingId) return;
      // 配信は誰の視点でもない — me は各クライアントが actor_ids と自分の id で引き直す。
      if (op.event === "chat") append((op.data || {}) as TMeetingChatMessage);
      else if (op.event === "chat_edit") replaceMsg((op.data || {}) as TMeetingChatMessage);
      else if (op.event === "chat_delete") removeMsg(String((op.data as { id?: string })?.id || ""));
      else if (op.event === "chat_reaction") {
        const d = (op.data || {}) as { id?: string; reactions?: TMeetingChatReaction[] };
        if (d.id) setReactions(String(d.id), d.reactions || []);
      }
    });
  }, [meetingId, append, replaceMsg, removeMsg, setReactions]);

  // 会期を切り替えたら既読位置を読み直す。線はこの時だけ引き直す。
  useEffect(() => {
    const saved = (meetingId && storage.get(readKey(meetingId))) || "";
    lastReadRef.current = saved;
    setDividerAt(saved || null); // 初訪問(保存なし)は全部が新規 = 線は引かない
    setUnreadCount(0);
  }, [meetingId]);

  /** 末尾まで見えている = そこまで読んだ。既読位置を進めて件数を消す。 */
  const markRead = useCallback(() => {
    const last = msgs[msgs.length - 1];
    if (!last) return;
    if (ts(last.at) <= ts(lastReadRef.current)) return;
    lastReadRef.current = last.at;
    if (meetingId) storage.set(readKey(meetingId), last.at);
    setUnreadCount(0);
  }, [msgs, meetingId]);

  /**
   * 既読判定は「見えていて」かつ「末尾に居る」時だけ。
   * 裏タブで流れていった発言を勝手に既読にしない — それをやると通知の意味が消える。
   */
  useEffect(() => {
    const sync = () => {
      if (!document.hidden && pinnedRef.current) markRead();
      else
        setUnreadCount(
          msgs.filter((m) => m.author?.id !== myId && ts(m.at) > ts(lastReadRef.current)).length // 自分の発言は未読に数えない
        );
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [msgs, myId, markRead]);

  // 裏タブでも気づけるように件数をタブへ出す(sticky banner は貼らない方針)。
  useEffect(() => {
    if (unreadCount > 0) registerTabBadge(CHAT_BADGE_KEY, { priority: 20, glyph: "💬", count: unreadCount });
    else unregisterTabBadge(CHAT_BADGE_KEY);
  }, [unreadCount]);

  // アンマウント時は必ず外す。残すと画面を離れた後も幽霊バッジが出続ける。
  useEffect(() => () => unregisterTabBadge(CHAT_BADGE_KEY), []);

  /** 線を引く位置 = 未読のうち最初の 1 件(自分の発言は起点にしない)。 */
  const firstUnreadId = useMemo(() => {
    if (!dividerAt) return null;
    const cut = ts(dividerAt);
    return msgs.find((m) => m.author?.id !== myId && ts(m.at) > cut)?.id ?? null;
  }, [msgs, dividerAt, myId]);

  /** 線に添える件数。既読にしても線は残るので unreadCount とは別に数える。 */
  const unreadCountFromDivider = useMemo(() => {
    if (!dividerAt) return 0;
    const cut = ts(dividerAt);
    return msgs.filter((m) => m.author?.id !== myId && ts(m.at) > cut).length;
  }, [msgs, dividerAt, myId]);

  // 末尾に居る人だけ追従させる。過去を読み返している人を引きずり下ろさない。
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (pinnedRef.current && !document.hidden) markRead();
  };

  useEffect(() => {
    const el = listRef.current;
    // scrollIntoView は祖先まで巻き込む(画面ごと横にずれた前例あり)。この箱だけ動かす。
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  /** 差し替え / 送信後に objectURL を必ず手放す(貼り直しの多い画面なので溜まると効く)。 */
  const dropPending = useCallback(() => {
    setPending((p) => {
      if (p) URL.revokeObjectURL(p.preview);
      return null;
    });
  }, []);

  // 画面を離れる時の取りこぼしだけ ref 経由で片付ける(依存に pending を入れると差し替えの度に走る)。
  const pendingRef = useRef<PendingImage | null>(null);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.preview);
    },
    []
  );

  /**
   * 貼られた 1 枚を先に上げ切ってしまう。送信の瞬間に待たされないのが会議のテンポ。
   * 上げ終わるまで送信ボタンは止める — asset_id の無い発言を作ると画像だけ消える。
   */
  const attachImage = useCallback(
    async (file: File) => {
      if (readOnly) return;
      if (!IMAGE_TYPES.includes(file.type)) {
        setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.chat.image_unsupported") });
        return;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.chat.image_too_large") });
        return;
      }
      const token = ++uploadTokenRef.current;
      const preview = URL.createObjectURL(file);
      // 寸法は貼った側で測って一緒に送る → 受け手は読み込み前に場所を確保できる(視界が跳ねない)。
      let width = 0;
      let height = 0;
      try {
        const bmp = await createImageBitmap(file);
        width = bmp.width;
        height = bmp.height;
        bmp.close?.();
      } catch {
        /* 測れなくても貼れる(受け手が読み込んでから決めるだけ) */
      }
      if (uploadTokenRef.current !== token) {
        URL.revokeObjectURL(preview);
        return;
      }
      setPending((prev) => {
        if (prev) URL.revokeObjectURL(prev.preview);
        return { preview, name: file.name || "", width, height, assetId: null, failed: false };
      });
      try {
        const assetId = await weeklyService.uploadChatImage(workspaceSlug, meetingId, file);
        if (uploadTokenRef.current !== token) return;
        if (!assetId) throw new Error("no asset id");
        setPending((p) => (p && p.preview === preview ? { ...p, assetId } : p));
      } catch {
        if (uploadTokenRef.current !== token) return;
        setPending((p) => (p && p.preview === preview ? { ...p, failed: true } : p));
        setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.chat.image_failed") });
      }
    },
    [readOnly, t, workspaceSlug, meetingId]
  );

  /** 画像が入ると高さが変わる。末尾に居た人はそのまま末尾に留める。 */
  const keepPinned = useCallback(() => {
    const el = listRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  const uploading = !!pending && !pending.assetId && !pending.failed;
  const sendableImage = pending?.assetId && !pending.failed ? pending : null;

  const send = async () => {
    const body = text.trim();
    if ((!body && !sendableImage) || sending || uploading) return;
    setSending(true);
    try {
      const msg = await weeklyService.chatSend(
        workspaceSlug,
        meetingId,
        body,
        replyingTo?.id,
        sendableImage
          ? {
              asset_id: sendableImage.assetId as string,
              width: sendableImage.width || undefined,
              height: sendableImage.height || undefined,
            }
          : undefined
      );
      setText("");
      setReplyingTo(null);
      dropPending();
      pinnedRef.current = true;
      append(msg);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.chat.failed") });
    } finally {
      setSending(false);
    }
  };

  /** 引用元へ跳ぶ(この箱だけ動かす — 祖先を巻き込むと画面ごとズレる前例あり)。 */
  const jumpTo = (id: string) => {
    const cont = listRef.current;
    if (!cont) return;
    const el = cont.querySelector(`[data-mid="${id}"]`) as HTMLElement | null;
    if (!el) return;
    cont.scrollTop += el.getBoundingClientRect().top - cont.getBoundingClientRect().top - 40;
    setFlashId(id);
    window.setTimeout(() => setFlashId((c) => (c === id ? null : c)), 1200);
  };

  const startReply = (m: TMeetingChatMessage) => {
    closeMenus();
    setActiveId(null);
    setReplyingTo(m);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const closeMenus = () => {
    setPickerFor(null);
    setConfirmDel(null);
  };

  const toggleReaction = async (m: TMeetingChatMessage, emoji: string) => {
    if (readOnly) return;
    setPickerFor(null);
    try {
      const reactions = await weeklyService.chatReact(workspaceSlug, meetingId, m.id, emoji);
      setReactions(m.id, reactions);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.chat.failed") });
    }
  };

  const startEdit = (m: TMeetingChatMessage) => {
    closeMenus();
    setActiveId(null);
    setEditingId(m.id);
    setEditText(m.text);
  };

  const saveEdit = async (m: TMeetingChatMessage) => {
    const body = editText.trim();
    // 画像付きなら添え書きを空にできる。文字だけの発言を空にするのは編集ではなく取消なので通さない。
    if ((!body && !m.attachment) || busyId) return;
    if (body === m.text) {
      setEditingId(null);
      return;
    }
    setBusyId(m.id);
    try {
      const updated = await weeklyService.chatEdit(workspaceSlug, meetingId, m.id, body);
      replaceMsg(updated);
      setEditingId(null);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.chat.failed") });
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (m: TMeetingChatMessage) => {
    if (busyId) return;
    setBusyId(m.id);
    try {
      await weeklyService.chatDelete(workspaceSlug, meetingId, m.id);
      removeMsg(m.id);
      setConfirmDel(null);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("weekly.chat.failed") });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* tailwind-config が ::-webkit-scrollbar を全部 hidden にしているので、
          overflow-y-auto だけだと「スクロールはするがバーが見えない」画面になる。
          .vertical-scrollbar + scrollbar-sm が house idiom(週報側の列と同じ)。 */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="vertical-scrollbar scrollbar-sm min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4"
      >
        {!msgs.length ? (
          <div className="grid h-full place-items-center px-4">
            <div className="flex max-w-xs flex-col items-center gap-2 text-center">
              <MessagesSquare className="size-6 text-tertiary" strokeWidth={1.25} />
              <p className="text-12 leading-relaxed text-tertiary">{t("weekly.chat.empty")}</p>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {msgs.map((m, i) => {
              const prev = i > 0 ? msgs[i - 1] : null;
              const grouped =
                !!prev &&
                prev.author?.id === m.author?.id &&
                new Date(m.at).getTime() - new Date(prev.at).getTime() < SAME_AUTHOR_WINDOW_MS;
              const { primary, secondary, secondaryIsSource } = lines(m, viewer);
              const mine = !!myId && m.author?.id === myId;
              const editing = editingId === m.id;
              const reactions = m.reactions || [];
              const canAct = !readOnly && !editing;
              // 長文は既定で畳む。従言語は畳んでいる間は出さない — 主言語だけで概要は掴める。
              const isLong = !editing && primary.length + (secondary?.length || 0) > LONG_TEXT_CHARS;
              const clamped = isLong && !expanded[m.id];
              const divider = m.id === firstUnreadId && (
                /* 「ここから未読」の線。位置の目印なので accent 青(琥珀は行動信号の専用色)。 */
                <li aria-hidden className="mt-3 flex items-center gap-2 first:mt-0" data-unread-divider>
                  <span className="h-px flex-1 bg-accent-strong/40" />
                  <span className="shrink-0 text-11 font-medium text-accent-primary">
                    {t("weekly.chat.unread_divider", { count: unreadCountFromDivider })}
                  </span>
                  <span className="h-px flex-1 bg-accent-strong/40" />
                </li>
              );
              return (
                <Fragment key={m.id}>
                  {divider}
                  <li
                    key={m.id}
                    data-mid={m.id}
                    className={cn(
                      "group relative flex gap-2.5 rounded-md transition-colors",
                      grouped ? "mt-0" : "mt-3 first:mt-0",
                      flashId === m.id && "bg-accent-primary/10"
                    )}
                    onMouseLeave={closeMenus}
                  >
                    <span className="w-7 shrink-0 pt-0.5">
                      {!grouped && (
                        <Avatar
                          name={m.author?.display_name}
                          src={m.author?.avatar_url}
                          size="md"
                          shape="circle"
                          showTooltip={false}
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        /* max-sm では操作列が常時表示なので、名前と時刻の場所を空けておく。 */
                        <p className={cn("flex items-baseline gap-2", canAct && "max-sm:pr-28")}>
                          <span className="truncate text-12 font-medium text-secondary">
                            {m.author?.display_name || "—"}
                          </span>
                          <span className="shrink-0 text-11 tabular-nums text-placeholder">{fmtTime(m.at)}</span>
                        </p>
                      )}

                      {m.reply_to && !editing && (
                        /* 引用元の一行プレビュー。取り消された親は「撤回済み」だけ出す。 */
                        <button
                          type="button"
                          disabled={!!m.reply_to.deleted}
                          onClick={() => m.reply_to && !m.reply_to.deleted && jumpTo(m.reply_to.id)}
                          className={cn(
                            "mb-1 flex max-w-full items-center gap-1.5 rounded border-l-2 border-subtle py-0.5 pl-2 pr-1 text-left",
                            m.reply_to.deleted ? "cursor-default" : "hover:border-accent-strong hover:bg-layer-2"
                          )}
                        >
                          <CornerUpLeft className="size-3 shrink-0 text-placeholder" strokeWidth={2} />
                          {m.reply_to.deleted ? (
                            <span className="text-11 italic text-placeholder">{t("weekly.chat.reply_deleted")}</span>
                          ) : (
                            <>
                              <span className="shrink-0 text-11 font-medium text-secondary">
                                {m.reply_to.author || "—"}
                              </span>
                              <span className="min-w-0 truncate text-11 text-tertiary">
                                {quoteText(m.reply_to, viewer)}
                              </span>
                            </>
                          )}
                        </button>
                      )}

                      {editing ? (
                        /* その場編集 — 原文(主言語)だけ直す。訳はサーバが引き直す。 */
                        <div className="mt-0.5">
                          <textarea
                            autoFocus
                            rows={2}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                void saveEdit(m);
                              } else if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-full resize-none rounded-md border border-accent-strong bg-layer-transparent px-2.5 py-1.5 text-14 leading-relaxed text-primary outline-none"
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEdit(m)}
                              disabled={(!editText.trim() && !m.attachment) || busyId === m.id}
                              className="flex items-center gap-1 rounded-md bg-accent-primary px-2 py-1 text-11 font-medium text-white hover:opacity-90 disabled:opacity-50"
                            >
                              <Check className="size-3" strokeWidth={2.5} />
                              {t("weekly.chat.save")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-md px-2 py-1 text-11 text-tertiary hover:bg-layer-2"
                            >
                              {t("weekly.chat.cancel")}
                            </button>
                            <span className="text-11 text-placeholder">{t("weekly.chat.edit_hint")}</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* 画像だけの発言もある(会議では「これ見て」の一枚が本文になる)→ 空の行は出さない。 */}
                          {(!!primary || !!m.edited_at) && (
                            <p
                              className={cn(
                                "text-14 leading-relaxed whitespace-pre-wrap break-words text-primary",
                                clamped && "line-clamp-5"
                              )}
                            >
                              {primary}
                              {m.edited_at && (
                                <span className="ml-1.5 align-baseline text-11 text-placeholder">
                                  ({t("weekly.chat.edited")})
                                </span>
                              )}
                            </p>
                          )}
                          {secondary && !clamped && (
                            /* 従言語。**原文か訳文かは見る人の言語で入れ替わる** ので記号も出し分ける —
                               相手の言語で書かれた発言では、ここに出ているのは訳文ではなく原文。 */
                            <p className="mt-1 flex gap-1.5 border-l border-subtle pl-2 text-12 leading-relaxed whitespace-pre-wrap break-words text-tertiary">
                              <span className="shrink-0 pt-0.5">
                                {secondaryIsSource ? (
                                  <span className="text-11 font-medium text-placeholder">
                                    {t("weekly.chat.original")}
                                  </span>
                                ) : (
                                  <TranslateGlyph />
                                )}
                              </span>
                              <span className="min-w-0">{secondary}</span>
                            </p>
                          )}
                          {isLong && (
                            /* 畳んでいる事自体が見えないと「切れている」と読まれる。位置の目印なので accent 青。 */
                            <button
                              type="button"
                              onClick={() => setExpanded((s) => ({ ...s, [m.id]: !s[m.id] }))}
                              className="mt-1 flex items-center gap-1 text-11 font-medium text-accent-primary hover:underline"
                            >
                              {clamped ? (
                                <>
                                  <ChevronDown className="size-3" strokeWidth={2.5} />
                                  {t("weekly.chat.expand")}
                                </>
                              ) : (
                                <>
                                  <ChevronUp className="size-3" strokeWidth={2.5} />
                                  {t("weekly.chat.collapse")}
                                </>
                              )}
                            </button>
                          )}
                        </>
                      )}

                      {/* 貼られた画像。編集中も出す(何に添え書きしているか見えていること)。
                          寸法が判っていれば読み込み前に場所を確保する = 上を読んでいる人の視界が跳ねない。 */}
                      {m.attachment?.url && (
                        <a
                          href={m.attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 block w-fit max-w-full overflow-hidden rounded-md border border-subtle transition-colors hover:border-accent-strong"
                        >
                          <img
                            src={m.attachment.url}
                            alt={m.attachment.name || ""}
                            loading="lazy"
                            width={m.attachment.width ?? undefined}
                            height={m.attachment.height ?? undefined}
                            onLoad={keepPinned}
                            className="max-h-72 w-auto max-w-full object-contain"
                          />
                        </a>
                      )}

                      {/* リアクション集計。読み取りは常に、押下は会期 OPEN の間だけ。 */}
                      {reactions.length > 0 && !editing && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {reactions.map((r) => {
                            const me = !!myId && r.actor_ids.includes(myId);
                            const label = r.actors.slice(0, 8).join("、");
                            const pill = (
                              <>
                                <span className="text-13 leading-none">{r.reaction}</span>
                                <span className="text-11 tabular-nums">{r.count}</span>
                              </>
                            );
                            return readOnly ? (
                              <span
                                key={r.reaction}
                                title={label}
                                className={cn(
                                  "flex items-center gap-1 rounded-full border px-1.5 py-0.5",
                                  me
                                    ? "border-accent-strong bg-accent-primary/10 text-accent-primary"
                                    : "border-subtle text-secondary"
                                )}
                              >
                                {pill}
                              </span>
                            ) : (
                              <button
                                key={r.reaction}
                                type="button"
                                title={label}
                                onClick={() => void toggleReaction(m, r.reaction)}
                                className={cn(
                                  "flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition-colors hover:border-accent-strong",
                                  me
                                    ? "border-accent-strong bg-accent-primary/10 text-accent-primary"
                                    : "border-subtle text-secondary"
                                )}
                              >
                                {pill}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ホバー / タップで出る操作列。閉じた会期・編集中は出さない。 */}
                    {canAct && (
                      <div
                        className={cn(
                          /* top-0 = **自分の** 発言の右上に重ねる。-top-2 だと連続発言(mt-0)で
                             1 つ上の発言の最終行に被る — 特に max-sm は常時表示なので実害が出る。 */
                          "absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-md border border-subtle bg-layer-1 p-0.5 shadow-sm transition-opacity",
                          activeId === m.id || pickerFor === m.id || confirmDel === m.id
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100"
                        )}
                      >
                        <button
                          type="button"
                          aria-label={t("weekly.chat.react")}
                          onClick={() => {
                            setConfirmDel(null);
                            setPickerFor(pickerFor === m.id ? null : m.id);
                            setActiveId(m.id);
                          }}
                          className="grid size-6 place-items-center rounded text-tertiary hover:bg-layer-2 hover:text-secondary"
                        >
                          <SmilePlus className="size-3.5" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("weekly.chat.reply")}
                          onClick={() => startReply(m)}
                          className="grid size-6 place-items-center rounded text-tertiary hover:bg-layer-2 hover:text-secondary"
                        >
                          <Reply className="size-3.5" strokeWidth={2} />
                        </button>
                        {mine && (
                          <>
                            <button
                              type="button"
                              aria-label={t("weekly.chat.edit")}
                              onClick={() => startEdit(m)}
                              className="grid size-6 place-items-center rounded text-tertiary hover:bg-layer-2 hover:text-secondary"
                            >
                              <Pencil className="size-3.5" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              aria-label={t("weekly.chat.delete")}
                              onClick={() => {
                                setPickerFor(null);
                                setConfirmDel(confirmDel === m.id ? null : m.id);
                                setActiveId(m.id);
                              }}
                              className="grid size-6 place-items-center rounded text-tertiary hover:bg-red-500/10 hover:text-red-500"
                            >
                              <Trash2 className="size-3.5" strokeWidth={2} />
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* 絵文字パレット(固定セット)。操作列の下に開く — 上端で切れないため。 */}
                    {pickerFor === m.id && canAct && (
                      <div className="absolute right-0 top-8 z-20 flex gap-0.5 rounded-lg border border-subtle bg-layer-1 p-1 shadow-md">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => void toggleReaction(m, emoji)}
                            className="grid size-7 place-items-center rounded text-15 hover:bg-layer-2"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 取消の確認。押し間違いで発言が消えないように一手挟む。 */}
                    {confirmDel === m.id && canAct && (
                      <div className="absolute right-0 top-8 z-20 flex items-center gap-2 rounded-lg border border-subtle bg-layer-1 px-2.5 py-1.5 shadow-md">
                        <span className="text-11 text-secondary">{t("weekly.chat.delete_confirm")}</span>
                        <button
                          type="button"
                          onClick={() => void doDelete(m)}
                          disabled={busyId === m.id}
                          className="rounded bg-red-500 px-2 py-0.5 text-11 font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {t("weekly.chat.delete")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDel(null)}
                          className="grid size-5 place-items-center rounded text-tertiary hover:bg-layer-2"
                        >
                          <X className="size-3" strokeWidth={2.5} />
                        </button>
                      </div>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}

        {/* 上に戻って読んでいる間だけ出る「未読へ」。sticky なので一覧の外枠は動かさない。 */}
        {firstUnreadId && unreadCount > 0 && (
          <div className="sticky bottom-0 flex justify-center pt-2">
            <button
              type="button"
              onClick={() => jumpTo(firstUnreadId)}
              /* 行動を促す信号なので琥珀([[feedback_color_semantics]])。 */
              className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-11 font-medium text-amber-600 shadow-sm backdrop-blur hover:bg-amber-500/25 dark:text-amber-400"
            >
              <ArrowDown className="size-3" strokeWidth={2.5} />
              {t("weekly.chat.unread_jump", { count: unreadCount })}
            </button>
          </div>
        )}
      </div>

      {readOnly ? (
        <p className="border-t border-subtle px-4 py-3 text-11 leading-relaxed text-tertiary">
          {t("weekly.chat.closed")}
        </p>
      ) : (
        <div className="border-t border-subtle p-3 sm:p-4">
          {replyingTo && (
            /* 「誰の何に返すか」を打つ前に見せる。X で解除。 */
            <div className="mb-1.5 flex items-center gap-2 rounded-md border-l-2 border-accent-strong bg-layer-2 px-2 py-1">
              <CornerUpLeft className="size-3 shrink-0 text-accent-primary" strokeWidth={2} />
              <span className="shrink-0 text-11 font-medium text-secondary">
                {replyingTo.author?.display_name || "—"}
              </span>
              <span className="min-w-0 flex-1 truncate text-11 text-tertiary">{lines(replyingTo, viewer).primary}</span>
              <button
                type="button"
                aria-label={t("weekly.chat.cancel")}
                onClick={() => setReplyingTo(null)}
                className="grid size-5 shrink-0 place-items-center rounded text-tertiary hover:bg-layer-3"
              >
                <X className="size-3" strokeWidth={2.5} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-lg border border-subtle bg-layer-transparent px-2.5 py-2 focus-within:border-accent-strong">
            <textarea
              ref={composerRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter で送信。会議のテンポでは Ctrl+Enter は遅い。改行は Shift+Enter。
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t("weekly.chat.placeholder")}
              className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-14 leading-relaxed text-primary outline-none placeholder:text-placeholder"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              aria-label={t("weekly.chat.send")}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md transition-colors",
                text.trim() && !sending
                  ? "bg-accent-primary text-white hover:opacity-90"
                  : "cursor-not-allowed bg-layer-2 text-placeholder"
              )}
            >
              <SendHorizontal className="size-3.5" strokeWidth={2} />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-11 text-placeholder">{t("weekly.chat.hint")}</p>
        </div>
      )}
    </div>
  );
});
