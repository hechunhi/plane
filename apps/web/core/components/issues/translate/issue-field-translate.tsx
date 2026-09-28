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
// BARSOUL 2026-07-09 (hechun, BS-369): 助詞(が/は/を/に/で/と/の/も/か)。
// 漢字語だらけの短い業務タイトル(「物流会社が午後に45箱を集荷予定（FedEx発送）」
// kana比率0.1875)は比率判定だけだと zh 誤判 → 「查看日语译文」ボタンが誤表示され、
// クリックすると既に日文の題名を"翻訳"要求して 502/空振り。バックエンド _detect_src
// と対称に、助詞 2 個以上で比率を待たず ja 確定する。
const JA_PARTICLE_G = /[がはをにでとのもか]/g;
// BARSOUL 2026-09-18 (hechun, 日本人社員の報告: 楽天カード「楽天市場＿商品登録専用」
// 「商品の整理整頓」が ja 画面で中文に化けた): 字形シグナル。バックエンド
// comment.py の _JA_ONLY_CHARS / _CN_ONLY_CHARS / _JA_WORD_RE と【同じ字集合】
// (そちらから機械的に写す。片側だけ増やさない)。
//   ・JA_GLYPH = 日本の新字体/国字 + 日本で使う旧字体系(簡体と字形が違う字)。
//   ・CN_GLYPH = 簡体専属字 + 中文口語の助詞/代名詞。中日共通字は絶対に入れない。
//   ・JA_WORD  = 共用漢字だけで出来た日文専用語(到着/荷物/会社/予定/注文…)。
// 判定順: 混合→zh / 助詞2+→ja / 簡体字ゼロで(日本字形 or 假名 or 日文語)→ja /
// 簡体字2+で日本字形ゼロ・假名<半分→zh / 最後の砦として旧 kana 比率 0.2。
const JA_GLYPH_CHARS =
  "楽売発済険関変実応図対広気圧拡帰検権験続読転単専録沢価伝仮従縦蔵弁円歩桜経軽総縄" +
  "営栄労訳択歴覚覧観満効収込働駅鉄銭絵縁剤拠挙掲撃斉遅聴脳豊黒竜帯悪徳恵戻払換摂様" +
  "児処勧団囲壊塩増奨嬢巣廃徴悩憲戦戯抜拝挿捜揺斎歓歯殻毎浜渉渋溝滝瀬焼犠猟獣産畳県" +
  "砕穀穂窓粋継緑繊聡臓薬虜覇視説譲賛辺郷酔釈鋳顕髄麺齢亜仏剣剰厳呉圏姫寛巻庁弾戸暦" +
  "査涙稲穏粛絶舎荘蛍衆証謡鉱雑霊頼顔髪鶏黙畑枠匂駆診製給張請約確認書類風報訪問場運" +
  "車東門長開見時語誤調談課謝負責財質購費資較達進遠選連郵銀錯鍵鏡閉聞隊階際陸難頁頂" +
  "項順須顧領題額飛飯館馬魚鳥復備頭園塊堅審導歳島幣師態執損樹標極構漢測熱環療盤監蓋" +
  "礎離種積筆簡緊純納紙線練組細織終紹績縮網勝節補規計討訓講評識訴話諸貝貢敗貧貫貼貴" +
  "貸貿趨軌輪軟載輩違遺針鋼鋒陽陰陣霧飲飾両麗義買親傷蘭興農決浄則剛創別劇動勢啓響聖" +
  "奪婦孫寧層異棄強護掛敵晩暫術欄橋夢湯潔塗漸煩電罰罷腸腫脹艦獲謎賊趙躍輔跡遜隣醤釣" +
  "鈴銅鍋鋭錦鎮頑頻飽駐値結維記設論議員業誕後為個幾準機貨輸務還訂韓現過適鎖鐘陳級紀" +
  "統綜編緩許詞試該詳誰賢販贈遷釘舗閑閲隠複奮賓尋幹慶庫徹懐驚慣願掃擬揮濃潤減滅愛禍" +
  "窮競築糧綱紛羅職騰藍慮襲賞裏預鮮鳴龍岡憂懸桟殺範紅習臨衛誌賃軍闘飼養";
const CN_GLYPH_CHARS =
  "们给让报对问关优现务应单这东车书长门说请帮过还没钱样亿仅从仓职业图时间为发货运输" +
  "价值产见开确认证订经结统续维记设论议许译词试该详语误调谈读课谁谢负责财质购费资较" +
  "辑边达进远选连递邮铁银错销锁键镜闭闲闻阅队阶际陆陈险随难页顶项顺须顾顿预领题额风" +
  "飞饭馆马验鱼鲜鸟鸡齐龙变复备头够团园围圆场块坚实审宽寻导岁岛币师带广张归录总态恶" +
  "户扩执扫择换损权树标检极构欢汇汉沟泪测济满热环疗盘监盖码础离种积称稳笔签简筹类紧" +
  "纯纲纳纸线练组细织终绍绝继绩绿缘缩罗网联脑胜节药营蓝虽补观规视览觉触计讨训讲访评" +
  "识诉话诗诸贝贡败贫贯贴贵贷贸赛赞赢赶趋轨转轮软轻载辆辈违迟逻遗释针钉钢钥铺链锋阳" +
  "阴阵雾颗饮饰驾骗鸭龄尔儿两严丽义乐乡买亚亲众传伤伪你兰兴农决冲净击划则刚创别剧办" +
  "动劳势卖厂厅历压厉县听启响圣处夹夺奖妇妈娱孙宁层岗异弃强怜战扰护拥挂挤挡摄敌显晓" +
  "晚暂术杂杆柜栏档桥梦毕毁汤沪泽洁涂涨渐烦烧爷犹狈猎电疯盐砖秃竖筛篮粤纬绑绘绣绵缆" +
  "罚罢肠肤肿胀胶脏舰艰苹荐荣获萝蚀袜裤谜贼赚赵趁趟跃轿辅迈迹逊邻酱钓钻铃铜铝锅锐锦" +
  "镇闯闷阔顽颁颂颇频飘饱饼驱驶驻骂骄骤鲁鹅齿约吗呢吧啊呀嘛哦嗯您咱哪么它她址";
const JA_GLYPH_RE = new RegExp("[" + JA_GLYPH_CHARS + "]");
const CN_GLYPH_G = new RegExp("[" + CN_GLYPH_CHARS + "]", "g");
const KANA_STRICT_RE = /[ぁ-ゟァ-ヺ]/;
const JA_WORD_RE = /到着|荷物|会社|案内|名刺|食事|注文|予定|出荷|入荷|元日|会食|面接|休暇|振替/;
function isMixedCnJa(text: string): boolean {
  const kana = (text.match(KANA_STRICT_G) || []).length;
  if (kana < 6) return false;
  const cn = (text.match(CN_CHARS_G) || []).length;
  return cn >= 2;
}
// BARSOUL 2026-07-24: 週報/会議チャットからも同じ判定を使う(訳語と挙動をチームで
// 揃えるため)。判定ロジックの正本はここ 1 箇所 — 複製して分岐させない。
// (2026-09-18: comments/card/display.tsx の複製も撤去し、ここを import する。)
export function detectSrc(text: string): "ja" | "zh" | null {
  if (isMixedCnJa(text)) return "zh";
  if ((text.match(JA_PARTICLE_G) || []).length >= 2) return "ja";
  const cnOnly = (text.match(CN_GLYPH_G) || []).length;
  const hasJaGlyph = JA_GLYPH_RE.test(text);
  if (cnOnly === 0) {
    if (hasJaGlyph) return "ja";
    if (KANA_STRICT_RE.test(text)) return "ja";
    if (JA_WORD_RE.test(text)) return "ja";
  }
  const kana = (text.match(HK_RE_G) || []).length;
  const han = (text.match(HAN_RE_G) || []).length;
  const total = kana + han;
  if (total === 0) return null;
  if (cnOnly >= 2 && !hasJaGlyph && kana / total < 0.5) return "zh";
  if (kana / total >= 0.2) return "ja";
  if (han > 0) return "zh";
  return null;
}
export function htmlToPlain(html: string): string {
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
export function useAutoTranslatePref(): [boolean, (v: boolean) => void] {
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

export const TranslateGlyph = () => (
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
  // BARSOUL 2026-09-28: 「本文を書いている途中で突然まっさらな編集器に戻る」バグ対策。
  // ① ここで書き換わった原文(=本人が今書いている)には訳文を自動で被せない。
  //    外国語で書き始めた人の編集器が、自動保存の 1.5s 後に只読訳文へすり替わっていた。
  //    判定=原文が変わった瞬間にフォーカスがこの原文側にある。他人の realtime 編集は該当しない。
  const originalRef = useRef<HTMLDivElement>(null);
  const [editedHere, setEditedHere] = useState(false);
  useEffect(() => setEditedHere(false), [issueId]);

  // 原文編集(内容指纹変化)→ 訳キャッシュ無効化 + 再取得許可。
  useEffect(() => {
    fetchedRef.current = false;
    setTrContent(null);
    setErrorMsg(null);
    if (typeof document !== "undefined" && originalRef.current?.contains(document.activeElement)) setEditedHere(true);
  }, [raw]);

  const showOriginalEff = override !== null ? override : isSelf || editedHere ? true : !autoPref;
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

  // ② 【DOM 構造は常に同一】。以前は翻訳不可(空/語種未判定)のとき `<>{children}</>`、
  //    可能になると `<div>…<div>{children}</div></div>` を返していた。新規カードで本文を
  //    書く → 自動保存で source が空→日/中に変わる → 親の要素型が変わり React が children
  //    (tiptap 編集器)を unmount→mount。再 mount 時の initialValue はまだ古い "<p></p>"
  //    なので画面は空白に戻り、続けて打つとその空白起点の内容で保存を上書きしていた。
  //    翻訳可否で変えてよいのは操作行の「中身」だけ。操作行は高さも予約し、途中で
  //    出現して編集器が 20px 跳ねることもないようにする。
  const tgtName = canTranslate ? LANG_NAME[target][viewer] : "";
  const srcName = canTranslate ? LANG_NAME[src!][viewer] : "";
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
      <div
        aria-hidden={!canTranslate || undefined}
        className={`mb-1 flex h-4 items-center gap-1.5 text-[11px] text-tertiary ${canTranslate ? "" : "invisible"} ${barClassName ?? ""}`}
      >
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
      <div ref={originalRef} className={showingTranslation ? "hidden" : "block"}>
        {children}
      </div>

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
