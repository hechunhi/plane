/**
 * BARSOUL 2026-09-16 (hechun): 動態(/my-work)コメント抜粋の 表示翻訳。
 *
 * 一覧カード件名(card-title-translate.tsx)と同じ形の **模块級 batcher**:
 * 120ms 去抖でまとめて `POST /workspaces/{slug}/comment-translations/` に投げ、
 * 後端は少数だけ実訳して残りを pending で返す → 600ms 後に追いかける。
 * 後端キャッシュ = 詳細画面のコメント翻訳と同じ CommentTranslation 行なので、
 * ここで訳せばカードを開いた時も命中する(正本 1 箇所)。
 * **表示のみ — comment_html は一切変更しない**。
 */
import { useEffect, useMemo, useReducer } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { detectSrc, useAutoTranslatePref } from "./issue-field-translate";

type Lang = "zh" | "ja";

/** key = `${commentId}|${target}|${本文ハッシュ}` — 本文編集で key が変わり自然に再翻訳。 */
const _cache = new Map<string, string>(); // "" = 訳不要 or 恒久失敗 → 原文表示で確定
const _subs = new Map<string, Set<() => void>>();
const _meta = new Map<string, { commentId: string; target: Lang }>();
const _fails = new Map<string, number>();
const _queue = new Set<string>();
let _timer: ReturnType<typeof setTimeout> | null = null;
let _inflight = false;
let _slug = "";

const MAX_FAILS = 2;
const CHUNK = 60;

function _hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function _notify(key: string) {
  _subs.get(key)?.forEach((f) => f());
}

function _store(key: string, text: string) {
  _cache.set(key, text);
  _notify(key);
}

function _schedule(slug: string, delay = 120) {
  _slug = slug;
  if (_timer || _inflight) return;
  _timer = setTimeout(() => {
    _timer = null;
    void _flush();
  }, delay);
}

type TCommentTrResponse = {
  items?: Array<{ comment_id: string; text?: string; skip?: boolean }>;
  pending?: string[];
};

async function _flush() {
  if (_inflight) return;
  const keys = Array.from(_queue).filter((k) => !_cache.has(k));
  _queue.clear();
  if (!keys.length || !_slug) return;
  _inflight = true;
  const byTarget = new Map<Lang, string[]>();
  // `${commentId}|${target}` → keys。**同じ id が複数 key で並ぶ事がある**(動態のグループ頭は
  // 通知時点の件名を持つので、改名を挟むと同 issue が別ハッシュで複数回並ぶ)。1 対 1 で
  // 持つと最後の key しか確定せず、残りは永遠に原文のまま(2026-09-16 実バグ)。
  const keyOf = new Map<string, string[]>();
  const keysFor = (id: string, target: Lang) => keyOf.get(`${id}|${target}`) ?? [];
  for (const k of keys) {
    const m = _meta.get(k);
    if (!m) continue;
    const kk = `${m.commentId}|${m.target}`;
    keyOf.set(kk, [...(keyOf.get(kk) ?? []), k]);
    const arr = byTarget.get(m.target) ?? [];
    arr.push(m.commentId);
    byTarget.set(m.target, arr);
  }
  let hasPending = false;
  try {
    for (const [target, idsDup] of byTarget) {
      const ids = Array.from(new Set(idsDup)); // 同 id 複数 key → リクエストは 1 回
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        try {
          // 逐次が仕様(件名 batcher と同じ) — 並列に投げると後端で LLM に殺到する。
          // eslint-disable-next-line no-await-in-loop
          const r = await fetch(`/api/workspaces/${_slug}/comment-translations/`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
            body: JSON.stringify({ target_lang: target, comment_ids: chunk }),
          });
          if (!r.ok) {
            chunk.forEach((id) => keysFor(id, target).forEach(_requeueOrGiveUp));
            hasPending = true;
            continue;
          }
          // eslint-disable-next-line no-await-in-loop -- 上と同じ逐次ループ内。
          const j: TCommentTrResponse = await r.json();
          const seen = new Set<string>();
          (j.items ?? []).forEach((it) => {
            const ks = keysFor(it.comment_id, target);
            if (!ks.length) return;
            seen.add(it.comment_id);
            ks.forEach((k) => {
              if (it.skip || it.text) _store(k, it.text || "");
              else _requeueOrGiveUp(k);
            });
          });
          const pend = new Set(j.pending ?? []);
          chunk.forEach((id) => {
            if (seen.has(id)) return;
            const ks = keysFor(id, target);
            if (!ks.length) return;
            ks.forEach((k) => {
              if (pend.has(id)) _queue.add(k);
              else _store(k, ""); // 権限外/存在しない → 原文で確定
            });
          });
          if (pend.size > 0) hasPending = true;
        } catch {
          chunk.forEach((id) => keysFor(id, target).forEach(_requeueOrGiveUp));
          hasPending = true;
        }
      }
    }
  } finally {
    _inflight = false;
  }
  if (_queue.size > 0) _schedule(_slug, hasPending ? 600 : 120);
}

function _requeueOrGiveUp(key: string | undefined) {
  if (!key) return;
  const n = (_fails.get(key) ?? 0) + 1;
  _fails.set(key, n);
  if (n >= MAX_FAILS) _store(key, "");
  else _queue.add(key);
}

export type TTranslatedSnippet = {
  /** 表示用 plain text(訳せていれば訳文, それ以外は原文)。 */
  text: string;
  translated: boolean;
  original: string;
};

/**
 * コメント抜粋の表示翻訳。
 * @param commentId  通知 payload の new_identifier
 * @param html       通知 payload の new_value(コメント HTML)
 * @param toPlain    HTML → plain(呼び出し側の sanitize と同じ関数を渡す)
 * 訳せない/不要/未取得の間は原文 plain をそのまま返す(ちらつき無し)。
 */
export function useTranslatedCommentSnippet(
  commentId: string | null | undefined,
  html: string | null | undefined,
  toPlain: (h: string | undefined) => string | undefined
): TTranslatedSnippet {
  const { currentLocale } = useTranslation();
  const viewer: Lang = currentLocale === "ja" ? "ja" : "zh";
  const [autoPref] = useAutoTranslatePref();
  const { workspaceSlug } = useParams();
  const slug = typeof workspaceSlug === "string" ? workspaceSlug : undefined;

  const raw = html ?? "";
  const original = useMemo(() => toPlain(raw) || "", [raw, toPlain]);
  const src = useMemo(() => detectSrc(original), [original]);
  const needed = !!commentId && !!slug && autoPref && !!original.trim() && !!src && src !== viewer;
  const key = needed ? `${commentId}|${viewer}|${_hash(raw)}` : "";

  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!key || !slug || !commentId) return;
    let set = _subs.get(key);
    if (!set) {
      set = new Set();
      _subs.set(key, set);
    }
    set.add(force);
    if (!_cache.has(key)) {
      _meta.set(key, { commentId, target: viewer });
      _queue.add(key);
      _schedule(slug);
    }
    return () => {
      set?.delete(force);
      if (set && set.size === 0) _subs.delete(key);
    };
  }, [key, slug, commentId, viewer, force]);

  const tr = key ? _cache.get(key) : undefined;
  const trPlain = useMemo(() => (tr ? toPlain(tr) : ""), [tr, toPlain]);
  return { text: trPlain || original, translated: !!trPlain, original };
}
