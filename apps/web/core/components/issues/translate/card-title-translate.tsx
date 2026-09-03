/**
 * BARSOUL 2026-09-01 (hechun): 一覧カード件名の 表示翻訳。
 *
 * 詳細画面の件名/本文翻訳(issue-field-translate.tsx)と **同じ語種判定
 * (detectSrc)・同じ全局スイッチ `barsoul.autoTranslate`・同じ派生キャッシュ
 * (後端 IssueTranslation field="title")** を共有する —— 訳文の正本は 1 箇所。
 * **表示のみ — issue.name は一切変更しない**(原文は tooltip でいつでも読める)。
 *
 * 取数 = 模块級 batcher 120ms 去抖(DIS の ai-state-line.tsx と同型)。後端は
 * 1 リクエストにつき少数だけ実訳して残りを pending で返す → こちらは 600ms 後に
 * 追いかける。一度訳せば後端キャッシュ命中なので、二度目からは即時。
 */
import { useEffect, useMemo, useReducer } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { detectSrc, useAutoTranslatePref } from "./issue-field-translate";

type Lang = "zh" | "ja";

/** key = `${issueId}|${target}|${件名ハッシュ}` — 件名編集で key が変わり自然に再翻訳。 */
const _cache = new Map<string, string>(); // "" = 訳不要 or 恒久失敗 → 原文表示で確定
const _subs = new Map<string, Set<() => void>>();
const _meta = new Map<string, { issueId: string; target: Lang }>();
const _fails = new Map<string, number>();
const _queue = new Set<string>();
let _timer: ReturnType<typeof setTimeout> | null = null;
let _inflight = false;
let _slug = "";

const MAX_FAILS = 2;
const CHUNK = 100;

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

type TTitleTrResponse = {
  items?: Array<{ issue_id: string; text?: string; skip?: boolean }>;
  pending?: string[];
};

async function _flush() {
  if (_inflight) return;
  const keys = Array.from(_queue).filter((k) => !_cache.has(k));
  _queue.clear();
  if (!keys.length || !_slug) return;
  _inflight = true;
  // 読み手言語ごとに束ねる(通常は 1 種類)。
  const byTarget = new Map<Lang, string[]>();
  const keyOf = new Map<string, string>(); // `${issueId}|${target}` → key
  for (const k of keys) {
    const m = _meta.get(k);
    if (!m) continue;
    keyOf.set(`${m.issueId}|${m.target}`, k);
    const arr = byTarget.get(m.target) ?? [];
    arr.push(m.issueId);
    byTarget.set(m.target, arr);
  }
  let hasPending = false;
  try {
    for (const [target, ids] of byTarget) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        try {
          // 逐次が仕様。チャンクを並列に投げると後端で LLM に殺到する
          // (実訳は 1 リクエスト ≤8 件に絞ってある)。
          // eslint-disable-next-line no-await-in-loop
          const r = await fetch(`/api/workspaces/${_slug}/issue-title-translations/`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
            body: JSON.stringify({ target_lang: target, issue_ids: chunk }),
          });
          if (!r.ok) {
            chunk.forEach((id) => _requeueOrGiveUp(keyOf.get(`${id}|${target}`)));
            hasPending = true;
            continue;
          }
          // eslint-disable-next-line no-await-in-loop -- 上と同じ逐次ループ内。
          const j: TTitleTrResponse = await r.json();
          const seen = new Set<string>();
          (j.items ?? []).forEach((it) => {
            const k = keyOf.get(`${it.issue_id}|${target}`);
            if (!k) return;
            seen.add(it.issue_id);
            // skip=訳不要(空/同語/語種不明) → 原文で確定。text ありも確定。
            if (it.skip || it.text) _store(k, it.text || "");
            else _requeueOrGiveUp(k); // 今回失敗 → 数回だけ追い直す
          });
          const pend = new Set(j.pending ?? []);
          chunk.forEach((id) => {
            if (seen.has(id)) return;
            const k = keyOf.get(`${id}|${target}`);
            if (!k) return;
            // pending = 後端が「次回訳す」と言っている(失敗ではない)ので回数は数えない。
            if (pend.has(id)) _queue.add(k);
            else _store(k, ""); // 権限外/存在しない → 原文で確定
          });
          if (pend.size > 0) hasPending = true;
        } catch {
          chunk.forEach((id) => _requeueOrGiveUp(keyOf.get(`${id}|${target}`)));
          hasPending = true;
        }
      }
    }
  } finally {
    _inflight = false;
  }
  // 残り(pending / 一時失敗)は少し間を置いて追いかける — LLM を殺到させない。
  if (_queue.size > 0) _schedule(_slug, hasPending ? 600 : 120);
}

function _requeueOrGiveUp(key: string | undefined) {
  if (!key) return;
  const n = (_fails.get(key) ?? 0) + 1;
  _fails.set(key, n);
  if (n >= MAX_FAILS)
    _store(key, ""); // 諦めて原文表示(無限リトライ禁止)
  else _queue.add(key);
}

export type TTranslatedTitle = {
  /** 表示用件名(訳せていれば訳文, それ以外は原文)。 */
  title: string;
  /** 訳文を出しているか(tooltip / 翻訳マークの出し分け用)。 */
  translated: boolean;
  /** 原文(issue.name)。 */
  original: string;
};

/**
 * カード件名の表示翻訳。訳せない/不要/未取得の間は原文をそのまま返すので、
 * 呼び出し側は戻り値の `title` をそのまま描画すればよい(ちらつき無し)。
 */
export function useTranslatedTitle(issueId: string | undefined, name: string | null | undefined): TTranslatedTitle {
  const { currentLocale } = useTranslation();
  const viewer: Lang = currentLocale === "ja" ? "ja" : "zh";
  const [autoPref] = useAutoTranslatePref();
  const { workspaceSlug } = useParams();
  const slug = typeof workspaceSlug === "string" ? workspaceSlug : undefined;

  const original = name ?? "";
  const src = useMemo(() => detectSrc(original), [original]);
  const needed = !!issueId && !!slug && autoPref && !!original.trim() && !!src && src !== viewer;
  const key = needed ? `${issueId}|${viewer}|${_hash(original)}` : "";

  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!key || !slug || !issueId) return;
    let set = _subs.get(key);
    if (!set) {
      set = new Set();
      _subs.set(key, set);
    }
    set.add(force);
    if (!_cache.has(key)) {
      _meta.set(key, { issueId, target: viewer });
      _queue.add(key);
      _schedule(slug);
    }
    return () => {
      set?.delete(force);
      if (set && set.size === 0) _subs.delete(key);
    };
  }, [key, slug, issueId, viewer, force]);

  const tr = key ? _cache.get(key) : undefined;
  return { title: tr || original, translated: !!tr, original };
}

/**
 * カード件名 tooltip の中身 — 訳文を出している時は **原文も必ず併記**
 * (機械翻訳なので原文が最終的な拠り所。ホバーで確認できる)。
 */
export function TitleTooltipContent({ value }: { value: TTranslatedTitle }) {
  const { currentLocale } = useTranslation();
  const ja = currentLocale === "ja";
  if (!value.translated) return <>{value.original}</>;
  return (
    <span className="block">
      <span className="block">{value.title}</span>
      <span className="mt-1 block opacity-70">原文: {value.original}</span>
      <span className="mt-0.5 block text-[10px] opacity-60">
        {ja ? "AI 翻訳のため誤りの可能性あり、原文を優先" : "爱酱 AI 翻译，可能有误，请以原文为准"}
      </span>
    </span>
  );
}
