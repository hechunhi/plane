/**
 * BARSOUL 2026-06-15 (hechun): 卡片标题/正文 表示翻訳 — 評論翻訳(comments/card/display.tsx)
 * と同ロジック・同 UX(同じ全局「自動翻訳」スイッチ `barsoul.autoTranslate` を共有)。
 * **表示のみ — 原 issue.name / description_html は一切変更しない**(変更=内容編集になる)。
 * 訳文は派生キャッシュ(後端 IssueTranslation), トグルで原文へ。render-prop で訳文描画は
 * 呼び出し側(標題=div / 正文=只読 RichTextEditor)が決める。
 */
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/ui";

// ── 語種探知(評論版と同字種・同閾値; バックエンド _detect_src と対称)──────────
const HK_RE_G = /[぀-ゟ゠-ヿ]/g;
const HAN_RE_G = /[一-鿿]/g;
const KANA_STRICT_G = /[ぁ-ゟァ-ヺ]/g;
const CN_CHARS_G = /[们给让报对问关优现务应单这东车书长门说请帮过还没钱样亿仅从仓职业图]/g;
function isMixedCnJa(text: string): boolean {
  const kana = (text.match(KANA_STRICT_G) || []).length;
  if (kana < 6) return false;
  const cn = (text.match(CN_CHARS_G) || []).length;
  return cn >= 2;
}
function detectSrc(text: string): "ja" | "zh" | null {
  if (isMixedCnJa(text)) return "zh";
  const kana = (text.match(HK_RE_G) || []).length;
  const han = (text.match(HAN_RE_G) || []).length;
  const total = kana + han;
  if (total === 0) return null;
  if (kana / total >= 0.2) return "ja";
  if (han > 0) return "zh";
  return null;
}
function htmlToPlain(html: string): string {
  if (typeof window === "undefined") return (html || "").replace(/<[^>]+>/g, " ");
  try {
    const d = new DOMParser().parseFromString(html || "", "text/html");
    return (d.body.textContent || "").trim();
  } catch {
    return (html || "").replace(/<[^>]+>/g, " ");
  }
}
const otherLang = (l: "zh" | "ja"): "zh" | "ja" => (l === "zh" ? "ja" : "zh");
const LANG_NAME: Record<string, { zh: string; ja: string }> = {
  ja: { zh: "日语", ja: "日本語" },
  zh: { zh: "中文", ja: "中国語" },
};

// ── 全局「自動翻訳」プリファレンス — **評論と同じキー/イベントを共有**(統一スイッチ)──
const AUTO_TR_KEY = "barsoul.autoTranslate";
const AUTO_TR_EVENT = "barsoul:autoTranslate";
function readAutoTr(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(AUTO_TR_KEY) !== "0";
}
function useAutoTranslatePref(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(readAutoTr);
  useEffect(() => {
    const h = () => setV(readAutoTr());
    window.addEventListener("storage", h);
    window.addEventListener(AUTO_TR_EVENT, h);
    return () => {
      window.removeEventListener("storage", h);
      window.removeEventListener(AUTO_TR_EVENT, h);
    };
  }, []);
  const set = useCallback((nv: boolean) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTO_TR_KEY, nv ? "1" : "0");
    window.dispatchEvent(new Event(AUTO_TR_EVENT));
  }, []);
  return [v, set];
}

const TranslateGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 opacity-70"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
  </svg>
);

function InlineAutoToggle(props: { enabled: boolean; onChange: (v: boolean) => void; viewer: "zh" | "ja" }) {
  const { enabled, onChange, viewer } = props;
  const T =
    viewer === "zh"
      ? { label: "自动翻译", on: "开", off: "关", tip: "外语内容自动译成你的语言。关闭后默认显示原文。" }
      : { label: "自動翻訳", on: "ON", off: "OFF", tip: "外国語を自動で日本語へ。OFF で既定は原文表示。" };
  return (
    <Tooltip tooltipContent={T.tip} position="top-left">
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className="inline-flex items-center gap-1 transition-colors outline-none hover:text-secondary"
        aria-pressed={enabled}
      >
        <span>{T.label}</span>
        <span className={enabled ? "font-medium text-accent-primary" : "opacity-50"}>{enabled ? T.on : T.off}</span>
      </button>
    </Tooltip>
  );
}

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  field: "title" | "description";
  isHtml: boolean;
  /** 原文(title=纯文本 / description=HTML)。语种探测 + 内容指纹的来源。 */
  source: string | undefined | null;
  /** 原文渲染(可编辑组件)。译文显示时 CSS 隐藏以保留其状态,绝不卸载。 */
  children: ReactNode;
  /** 译文渲染(title→styled div / description→只读 RichTextEditor)。 */
  renderTranslated: (content: string) => ReactNode;
  /** 控制行额外类名(对齐标题/正文各自留白)。 */
  barClassName?: string;
};

export function IssueFieldTranslate(props: Props) {
  const { workspaceSlug, projectId, issueId, field, isHtml, source, children, renderTranslated, barClassName } = props;
  const { currentLocale } = useTranslation();
  const viewer: "zh" | "ja" = currentLocale === "ja" ? "ja" : "zh";

  const raw = source || "";
  const plain = useMemo(() => (isHtml ? htmlToPlain(raw) : raw), [raw, isHtml]);
  const src = detectSrc(plain);
  const canTranslate = !!src && !!plain.trim();
  const isSelf = !!src && src === viewer;
  const target: "zh" | "ja" = isSelf ? otherLang(src as "zh" | "ja") : viewer;

  const [autoPref, setAutoPref] = useAutoTranslatePref();
  const [override, setOverride] = useState<boolean | null>(null); // null=既定追随 / true=原文 / false=訳文
  const [trContent, setTrContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // 原文編集(内容指纹変化)→ 訳キャッシュ無効化 + 再取得許可。
  useEffect(() => {
    fetchedRef.current = false;
    setTrContent(null);
    setErrorMsg(null);
  }, [raw]);

  const showOriginalEff = override !== null ? override : isSelf ? true : !autoPref;
  const wantTranslation = canTranslate && !showOriginalEff;

  const doFetch = useCallback(
    async (force = false) => {
      if (fetchedRef.current && !force) return;
      fetchedRef.current = true;
      setErrorMsg(null);
      setLoading(true);
      try {
        const r = await fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/translate/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({ target_lang: target, field, source: src, force }),
        });
        const j = await r.json();
        if (!r.ok) setErrorMsg(viewer === "zh" ? "翻译暂时不可用" : "翻訳が一時的に失敗しました");
        else if (j.skip) {
          setErrorMsg(null);
          setTrContent(null);
        } else setTrContent(j.text || "");
      } catch {
        setErrorMsg(viewer === "zh" ? "网络错误，请重试" : "ネットワークエラー、再試行してください");
      } finally {
        setLoading(false);
      }
    },
    [workspaceSlug, projectId, issueId, target, field, src, viewer]
  );

  useEffect(() => {
    if (wantTranslation && !trContent && !fetchedRef.current) doFetch();
  }, [wantTranslation, trContent, doFetch]);

  if (!canTranslate) return <>{children}</>;

  const tgtName = LANG_NAME[target][viewer];
  const srcName = LANG_NAME[src!][viewer];
  const L =
    viewer === "zh"
      ? {
          showOrig: "显示原文",
          showTr: isSelf ? `查看${tgtName}译文` : "显示译文",
          from: isSelf ? `机器译文 · ${tgtName}` : `翻译自 ${srcName}`,
          loading: "翻译中…",
          retr: "重新翻译",
          retrTip: "译文有误/缺失时重新翻译",
        }
      : {
          showOrig: "原文を表示",
          showTr: isSelf ? `${tgtName}訳を見る` : "訳文を表示",
          from: isSelf ? `機械翻訳 · ${tgtName}` : `${srcName}から翻訳`,
          loading: "翻訳中…",
          retr: "再翻訳",
          retrTip: "訳文に誤り/欠落がある場合に再翻訳",
        };

  const showingTranslation = !!trContent && wantTranslation;

  return (
    <div>
      <div className={`mb-1 flex items-center gap-1.5 text-[11px] text-tertiary ${barClassName ?? ""}`}>
        <TranslateGlyph />
        {loading ? (
          <span className="inline-flex items-center gap-1">
            <span className="border-tertiary inline-block size-3 animate-spin rounded-full border border-t-transparent" />
            {L.loading}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOverride(showingTranslation)}
            className="text-accent-primary hover:underline"
          >
            {showingTranslation ? L.showOrig : L.showTr}
          </button>
        )}
        {showingTranslation && (
          <>
            <span className="opacity-50">·</span>
            <span
              title="※ 爱酱AI翻译，可能有误，请以原文为准 ／ AI翻訳のため誤りの可能性あり、原文を優先"
              className="cursor-help underline decoration-dotted underline-offset-2"
            >
              {L.from}
            </span>
            <button
              type="button"
              onClick={() => void doFetch(true)}
              title={L.retrTip}
              aria-label={L.retr}
              className="grid size-4 place-items-center rounded text-tertiary transition-colors hover:bg-layer-1 hover:text-secondary"
            >
              <RefreshCw className="size-3" strokeWidth={1.75} />
            </button>
          </>
        )}
        <span className="flex-1" />
        <InlineAutoToggle enabled={autoPref} onChange={setAutoPref} viewer={viewer} />
      </div>

      {showingTranslation && trContent != null && renderTranslated(trContent)}
      <div className={showingTranslation ? "hidden" : "block"}>{children}</div>

      {errorMsg && !loading && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-tertiary">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => void doFetch(true)} className="text-accent-primary hover:underline">
            {viewer === "zh" ? "重试" : "再試行"}
          </button>
        </div>
      )}
    </div>
  );
}
