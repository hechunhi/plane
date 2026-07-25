/**
 * BARSOUL 週次ミーティング — 双語トグル (hechun 2026-07-24)
 *
 * 卡片翻訳(issue-field-translate)と **同じ語種判定・同じ全局スイッチ** を共有する
 * (`barsoul.autoTranslate`)。訳語と挙動がチームで揃わないと、同じ会議で人によって
 * 違う日本語が出て混乱するため — 判定の正本は issue-field-translate 側 1 箇所。
 *
 * 構造保持: 平文へ落とす際に出処キーを `[BS-374]` として残し、訳文から拾い直す。
 * → 1 回の翻訳呼出で見出し・箇条書き・出処チップが生き残る(weekly-html.tsx 参照)。
 * **原文は一切変更しない** — 訳文は派生キャッシュ(ContentTranslation)。
 */
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/ui";
import { cn } from "@plane/utils";
import {
  TranslateGlyph,
  detectSrc,
  useAutoTranslatePref,
} from "@/components/issues/translate/issue-field-translate";
import { weeklyService, type TWeeklySource } from "@/services/weekly.service";
import { WeeklyHtml, blocksToPlain, parseWeeklyHtml, parseWeeklyPlain, type WeeklyRef } from "./weekly-html";

type Props = {
  workspaceSlug: string;
  entryId: string;
  /** 下書き / 確定版 のどちらを訳しているか。訳文キャッシュはこの単位で分かれる。 */
  field: "draft" | "content";
  html: string;
  sources: TWeeklySource[];
  onRefClick?: (projectId: string, issueId: string) => void;
};

export function WeeklyTranslate(props: Props) {
  const { workspaceSlug, entryId, field, html, sources, onRefClick } = props;
  const { currentLocale } = useTranslation();
  const viewer: "zh" | "ja" = currentLocale === "ja" ? "ja" : "zh";

  const blocks = useMemo(() => parseWeeklyHtml(html), [html]);
  const plain = useMemo(() => blocksToPlain(blocks), [blocks]);
  const refByKey = useMemo(() => {
    const m = new Map<string, WeeklyRef>();
    for (const s of sources || []) {
      const key = `${s.identifier}-${s.sequence_id}`;
      if (!m.has(key)) m.set(key, { key, projectId: s.project_id, issueId: s.issue_id });
    }
    return m;
  }, [sources]);

  const src = detectSrc(plain.replace(/\[[A-Za-z0-9]+-\d+\]/g, " "));
  const canTranslate = !!src && !!plain.trim();
  const isSelf = !!src && src === viewer;
  const target: "zh" | "ja" = isSelf ? (src === "zh" ? "ja" : "zh") : viewer;

  const [autoPref, setAutoPref] = useAutoTranslatePref();
  const [override, setOverride] = useState<boolean | null>(null); // null=既定追随 / true=原文 / false=訳文
  const [trText, setTrText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // 原文が変われば訳は無効(再集計・再生成・人の編集のいずれでも)
  useEffect(() => {
    fetchedRef.current = false;
    setTrText(null);
    setErrorMsg(null);
  }, [plain]);

  const showOriginal = override !== null ? override : isSelf ? true : !autoPref;
  const wantTranslation = canTranslate && !showOriginal;

  const doFetch = useCallback(
    async (force = false) => {
      if (fetchedRef.current && !force) return;
      fetchedRef.current = true;
      setErrorMsg(null);
      setLoading(true);
      try {
        const r = await weeklyService.translate(workspaceSlug, {
          entity: "weekly_entry",
          object_id: entryId,
          field,
          target_lang: target,
          text: plain,
        });
        setTrText(r?.text || "");
      } catch {
        setErrorMsg(viewer === "zh" ? "翻译暂时不可用" : "翻訳が一時的に失敗しました");
      } finally {
        setLoading(false);
      }
    },
    [workspaceSlug, entryId, field, target, plain, viewer]
  );

  useEffect(() => {
    if (wantTranslation && trText === null && !fetchedRef.current) void doFetch();
  }, [wantTranslation, trText, doFetch]);

  const showingTranslation = wantTranslation && !!trText;
  const trBlocks = useMemo(
    () => (showingTranslation ? parseWeeklyPlain(trText || "", refByKey) : []),
    [showingTranslation, trText, refByKey]
  );

  const L =
    viewer === "zh"
      ? {
          showOrig: "显示原文",
          showTr: isSelf ? "查看日语译文" : "显示译文",
          from: isSelf ? "机器译文" : "译自原文",
          loading: "翻译中…",
          retr: "重新翻译",
          note: "※ 爱酱AI翻译，可能有误，请以原文为准",
          auto: { label: "自动翻译", on: "开", off: "关", tip: "外语内容自动译成你的语言。关闭后默认显示原文。" },
        }
      : {
          showOrig: "原文を表示",
          showTr: isSelf ? "中国語訳を見る" : "訳文を表示",
          from: isSelf ? "機械翻訳" : "原文から翻訳",
          loading: "翻訳中…",
          retr: "再翻訳",
          note: "※ AI翻訳のため誤りの可能性あり、原文を優先",
          auto: { label: "自動翻訳", on: "ON", off: "OFF", tip: "外国語を自動で日本語へ。OFF で既定は原文表示。" },
        };

  return (
    <div className="flex flex-col gap-2.5">
      {canTranslate && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-11 text-tertiary">
          <TranslateGlyph />
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 animate-spin rounded-full border border-tertiary border-t-transparent" />
              {L.loading}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setOverride(showingTranslation)}
              className="text-accent-primary transition-colors hover:underline"
            >
              {showingTranslation ? L.showOrig : L.showTr}
            </button>
          )}
          {showingTranslation && (
            <>
              <span className="opacity-40">·</span>
              <span title={L.note} className="cursor-help underline decoration-dotted underline-offset-2">
                {L.from}
              </span>
              <button
                type="button"
                onClick={() => void doFetch(true)}
                aria-label={L.retr}
                title={L.retr}
                className="grid size-4 place-items-center rounded text-tertiary transition-colors hover:bg-layer-1 hover:text-secondary"
              >
                <RefreshCw className="size-3" strokeWidth={1.75} />
              </button>
            </>
          )}
          <span className="flex-1" />
          <Tooltip tooltipContent={L.auto.tip} position="top-left">
            <button
              type="button"
              onClick={() => setAutoPref(!autoPref)}
              aria-pressed={autoPref}
              className="inline-flex items-center gap-1 outline-none transition-colors hover:text-secondary"
            >
              <span>{L.auto.label}</span>
              <span className={cn(autoPref ? "font-medium text-accent-primary" : "opacity-50")}>
                {autoPref ? L.auto.on : L.auto.off}
              </span>
            </button>
          </Tooltip>
        </div>
      )}

      <WeeklyHtml blocks={showingTranslation ? trBlocks : blocks} onRefClick={onRefClick} />

      {errorMsg && !loading && (
        <div className="flex items-center gap-2 text-11 text-tertiary">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => void doFetch(true)} className="text-accent-primary hover:underline">
            {viewer === "zh" ? "重试" : "再試行"}
          </button>
        </div>
      )}
    </div>
  );
}
