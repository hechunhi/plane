/**
 * BARSOUL 2026-10-08 (hechun「搜索功能好好做 / 全屏浮层」): 全屏搜索浮层。
 * 设计已批(memory project_plane_ai_search, D1-D10 别重开):
 *  - D1 ⌘K 与顶栏搜索框打开这同一个浮层; 输入 `>` 交给原 Power-K 命令面板。
 *  - D3 编号直达(BS-425 / bs425)排第一。D4 关键字+意思相近混合, 每条标来源。
 *  - Q3 已归档/已完成也搜, 灰显。D10 Esc 关闭不丢输入, 空状态=最近打开+最近问过+试试。
 * 关闭时 Dialog 子树会卸载 → 输入/结果放在外层 root(常驻)里, 重开即恢复。
 * P1 问爱酱(D2/D6/D7): 列表首行「问爱酱：…」; 像问句默认选中→回车问, 否则 Tab 问。
 *  回答每句带 [n], 悬停看片段, 点开跳到那张卡/那条评论; 爱酱在这里只读。
 * P2 (D7/D8/D10):
 *  - 追问留在浮层: 回答视图里输入框=追问框, 回车接着问(带上一问做检索 + 本线程问答做上下文);
 *    回答下给 2-3 个建议追问; 「新搜索」清空线程; 闲置 30 分钟重开浮层=新线程。
 *  - 「在 BS-xxx 私聊继续」: 把这段问答写进那张卡的私聊草稿, 跳过去并打开私聊面板(只填草稿, 不发送)。
 *  - 👍👎 只写日志(ai-bot search-feedback.jsonl), 用来调检索。
 *  - 输入 @ 加筛选(负责人 / 状态), 以 chip 显示在输入框里, 搜索和问爱酱都生效。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Dialog, Transition } from "@headlessui/react";
import {
  Archive,
  ArrowLeft,
  CircleDot,
  Clock,
  CornerDownLeft,
  Loader,
  MessageSquare,
  MessagesSquare,
  RotateCcw,
  Search,
  Sparkles,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  User,
  X,
} from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// 私聊面板衔接: 只用它公开的「重开请求」, 不改私聊模块本身
import { requestReopen } from "@/components/comments/aichan-chat/jobs";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { usePowerK } from "@/hooks/store/use-power-k";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import type {
  TBarsoulAskSource,
  TBarsoulAskTurn,
  TBarsoulSearchFilters,
  TBarsoulSearchResponse,
  TBarsoulSearchResult,
} from "@/services/barsoul-search.service";
import { barsoulSearchService } from "@/services/barsoul-search.service";

type TRecent = { id: string; ident: string; name: string };

const RECENT_MAX = 8;
const ASKS_MAX = 3;
const recentKey = (slug: string) => `barsoul:search-recent:${slug}`;
const asksKey = (slug: string) => `barsoul:search-asks:${slug}`;

const readJson = <T,>(key: string): T[] => {
  try {
    const raw = window.localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeJson = (key: string, list: unknown[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* 隐私模式等: 最近记录只是便利, 写不进就算了 */
  }
};

const readRecent = (slug: string): TRecent[] =>
  readJson<TRecent>(recentKey(slug))
    .filter((r) => r && r.ident && r.name)
    .slice(0, RECENT_MAX);

const readAsks = (slug: string): string[] =>
  readJson<string>(asksKey(slug))
    .filter((q) => typeof q === "string" && q.trim())
    .slice(0, ASKS_MAX);

type TTurn = {
  q: string;
  status: "running" | "done" | "error" | "no_sources";
  sources: TBarsoulAskSource[];
  reply: string;
  followups: string[];
  vote?: "up" | "down";
};

const ASK_POLL_MS = 1500;
const ASK_TIMEOUT_MS = 120_000;
// D8: 闲置 30 分钟后重开浮层 = 新线程(旧问答不再当上下文)
const THREAD_IDLE_MS = 30 * 60 * 1000;
const HISTORY_TURNS = 3;

// 像问句 → 首行「问爱酱」默认选中(回车即问); 否则默认选第一条结果, 要问按 Tab
const QUESTION_RE =
  /[?？]\s*$|^(谁|什么|怎么|怎样|为什么|为何|哪|是否|有没有|能不能|可以|如何|几|多少)|(吗|呢|么)[?？]?\s*$|^(誰|何|なぜ|どう|どこ|いつ|どれ)|(ですか|ますか|かな|の\?)\s*$|^(who|what|why|how|when|where|which|is|are|do|does|can|should)\b/i;
const looksLikeQuestion = (q: string) => QUESTION_RE.test(q.trim());

const CITE_RE = /\[(\d{1,2}(?:\s*[,，、]\s*\d{1,2})*)\]/g;

/** 回答里的 [1] / [1,2] / [1][3] → 出处角标 */
const splitCitations = (text: string) => {
  const out: ({ kind: "text"; s: string } | { kind: "cite"; ns: number[] })[] = [];
  const re = new RegExp(CITE_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", s: text.slice(last, m.index) });
    out.push({ kind: "cite", ns: m[1].split(/[,，、]/).map((x) => parseInt(x.trim(), 10)) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", s: text.slice(last) });
  return out;
};

const stripCitations = (text: string) =>
  text
    .replace(new RegExp(CITE_RE.source, "g"), "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

/** 衔接目标: 回答里第一个被引用的出处, 没引用就取第一条资料 */
const handoffTarget = (turn: TTurn): TBarsoulAskSource | undefined => {
  for (const p of splitCitations(turn.reply)) {
    if (p.kind !== "cite") continue;
    for (const n of p.ns) {
      const s = turn.sources.find((x) => x.n === n);
      if (s) return s;
    }
  }
  return turn.sources[0];
};

const isDone = (r: TBarsoulSearchResult) =>
  r.archived || r.state_group === "completed" || r.state_group === "cancelled";

/* ── @ 筛选 ─────────────────────────────────────────────────────────────── */

const STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;
type TChip = { kind: "assignee" | "state"; value: string; label: string };
// 输入框末尾正在打的 @token(@ 前必须是开头或空白, 免得邮箱之类误触)
const AT_RE = /(^|\s)@(\S*)$/;
const PICK_MAX = 10;

const chipsToFilters = (chips: TChip[]): TBarsoulSearchFilters => ({
  assignee: chips.filter((c) => c.kind === "assignee").map((c) => c.value),
  state_group: chips.filter((c) => c.kind === "state").map((c) => c.value),
});

/** 片段里把查询词标出来(纯展示, 大小写不敏感) */
const Highlight = ({ text, terms }: { text: string; terms: string[] }) => {
  const parts = useMemo(() => {
    const ts = terms.filter((t) => t.length > 0);
    if (!text || ts.length === 0) return [{ s: text, hit: false }];
    const esc = ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(${esc.join("|")})`, "gi");
    return text
      .split(re)
      .filter((s) => s !== "")
      .map((s) => ({ s, hit: ts.some((t) => t.toLowerCase() === s.toLowerCase()) }));
  }, [text, terms]);
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-accent-subtle px-0.5 text-primary">
            {p.s}
          </mark>
        ) : (
          <Fragment key={i}>{p.s}</Fragment>
        )
      )}
    </>
  );
};

/** 出处角标: 悬停看片段(D6), 点开跳卡/评论 */
const Cite = ({ src, onOpen }: { src: TBarsoulAskSource | undefined; onOpen: () => void }) => {
  if (!src) return null;
  return (
    <span className="group relative inline-block align-baseline">
      <button
        type="button"
        onClick={onOpen}
        className="font-mono mx-0.5 rounded bg-accent-subtle px-1 text-11 leading-4 text-accent-primary hover:bg-accent-primary hover:text-on-color"
      >
        {src.n}
      </button>
      <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-1 w-72 -translate-x-1/2 rounded-md border border-subtle-1 bg-surface-1 p-2 text-left text-12 opacity-0 shadow-raised-200 transition-opacity group-hover:visible group-hover:opacity-100">
        <span className="block truncate font-medium text-primary">
          <span className="font-mono mr-1 text-tertiary">{src.ident}</span>
          {src.name}
        </span>
        {src.snippet && <span className="mt-1 line-clamp-3 block text-secondary">{src.snippet}</span>}
      </span>
    </span>
  );
};

const Reply = ({ turn, onOpen }: { turn: TTurn; onOpen: (s: TBarsoulAskSource) => void }) => (
  <div className="text-14 leading-6 break-words whitespace-pre-wrap text-primary">
    {splitCitations(turn.reply).map((part, i) =>
      part.kind === "text" ? (
        <Fragment key={i}>{part.s}</Fragment>
      ) : (
        <Fragment key={i}>
          {part.ns.map((n) => {
            const src = turn.sources.find((x) => x.n === n);
            return <Cite key={n} src={src} onOpen={() => src && onOpen(src)} />;
          })}
        </Fragment>
      )
    )}
  </div>
);

export const BarsoulSearchOverlay = observer(function BarsoulSearchOverlay() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const router = useAppRouter();
  const { t, currentLocale } = useTranslation();
  const { isSearchOverlayOpen, toggleSearchOverlay, togglePowerKModal } = usePowerK();
  const {
    getUserDetails,
    workspace: { getWorkspaceMemberIds },
  } = useMember();
  // 常驻状态(关掉再开还在)
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<TChip[]>([]);
  const [data, setData] = useState<TBarsoulSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<TRecent[]>([]);
  const [recentAsks, setRecentAsks] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  // 问爱酱线程(常驻, Esc 关掉再开回答还在 —— D10; 闲置 30 分钟作废 —— D8)
  const [thread, setThread] = useState<TTurn[]>([]);
  const [threadAt, setThreadAt] = useState(0);
  const [answerView, setAnswerView] = useState(false);
  const [followup, setFollowup] = useState("");
  const askSeqRef = useRef(0);

  const close = useCallback(() => toggleSearchOverlay(false), [toggleSearchOverlay]);
  const lang = String(currentLocale || "ja");
  const filters = useMemo(() => chipsToFilters(chips), [chips]);
  const filterKey = chips.map((c) => `${c.kind}:${c.value}`).join(",");

  const resetThread = useCallback(() => {
    askSeqRef.current += 1; // 停掉正在轮询的回答
    setThread([]);
    setAnswerView(false);
    setFollowup("");
  }, []);

  // 打开时: 读最近 + 全选输入(直接打字=新搜, 方向键=沿用上次); 线程闲置太久就作废
  useEffect(() => {
    if (!isSearchOverlayOpen || !slug) return;
    setRecent(readRecent(slug));
    setRecentAsks(readAsks(slug));
    if (thread.length > 0 && Date.now() - threadAt > THREAD_IDLE_MS) resetThread();
    const id = window.setTimeout(() => {
      if (answerView) inputRef.current?.focus();
      else inputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(id);
    // 只在开/关时跑; thread/answerView 是读当下值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchOverlayOpen, slug]);

  // @ 选择器: 输入末尾正在打 @xxx 时显示, 期间不搜索
  const atMatch = !answerView ? AT_RE.exec(query) : null;
  const pickerToken = atMatch ? atMatch[2].toLowerCase() : null;
  const pickerOpen = pickerToken !== null;

  const pickerOptions = useMemo<TChip[]>(() => {
    if (pickerToken === null || !slug) return [];
    const taken = new Set(chips.map((c) => `${c.kind}:${c.value}`));
    const tok = pickerToken;
    const hit = (s: string) => !tok || s.toLowerCase().includes(tok);
    const out: TChip[] = [];
    const me = t("search_overlay.filter_me");
    if (hit(me) || hit("me")) out.push({ kind: "assignee", value: "me", label: me });
    for (const g of STATE_GROUPS) {
      const label = t(`search_overlay.sg_${g}`);
      if (hit(label) || hit(g)) out.push({ kind: "state", value: g, label });
    }
    for (const id of getWorkspaceMemberIds(slug) ?? []) {
      const u = getUserDetails(id);
      if (!u || u.is_bot) continue;
      const name = u.display_name || `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
      if (!name) continue;
      if (hit(name) || hit(`${u.first_name ?? ""} ${u.last_name ?? ""}`))
        out.push({ kind: "assignee", value: id, label: name });
    }
    return out.filter((c) => !taken.has(`${c.kind}:${c.value}`)).slice(0, PICK_MAX);
  }, [pickerToken, slug, chips, t, getWorkspaceMemberIds, getUserDetails]);

  // 防抖搜索; 只认最后一次请求(seq), 旧响应丢弃。有筛选时空关键字也搜(=列出符合筛选的卡)
  const trimmed = query.trim();
  const searchable = !!trimmed || chips.length > 0;
  const dataKey = `${trimmed}|${filterKey}`;
  const [dataFor, setDataFor] = useState("");
  useEffect(() => {
    if (!slug || pickerOpen) return;
    if (!searchable) {
      seqRef.current += 1;
      setData(null);
      setDataFor("");
      setLoading(false);
      setError(false);
      return;
    }
    const seq = ++seqRef.current;
    const key = dataKey;
    setLoading(true);
    const timer = window.setTimeout(() => {
      barsoulSearchService
        .search(slug, trimmed, filters)
        .then((res) => {
          if (seq !== seqRef.current) return;
          setData(res);
          setDataFor(key);
          setError(false);
          // 首行是「问爱酱」: 像问句 → 选它; 否则选第一条结果
          const hasAsk = !!trimmed && !res.exact;
          setActive(hasAsk && res.results.length > 0 && !looksLikeQuestion(trimmed) ? 1 : 0);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setError(true);
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
    // filters 由 filterKey 代表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, slug, pickerOpen]);

  const terms = useMemo(() => trimmed.split(/\s+/).filter(Boolean).slice(0, 6), [trimmed]);
  const fresh = dataFor === dataKey;
  const results = searchable ? (data?.results ?? []) : [];
  const showRecent = !searchable && !pickerOpen;
  // D3: 编号直达不进 AI → 没有「问爱酱」行
  const askRow = !pickerOpen && !!trimmed && !(fresh && data?.exact);
  const offset = askRow ? 1 : 0;
  const itemCount = pickerOpen ? pickerOptions.length : showRecent ? recent.length : results.length + offset;

  // 停在悬空索引上(结果变少)时拉回
  useEffect(() => {
    if (active >= itemCount && itemCount > 0) setActive(0);
  }, [active, itemCount]);

  // 选中项跟随滚动
  useEffect(() => {
    if (answerView) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, answerView]);

  // 回答视图: 新一轮出来时滚到最新那轮的开头
  const lastTurnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!answerView) return;
    lastTurnRef.current?.scrollIntoView({ block: "start" });
  }, [thread.length, answerView]);

  const remember = useCallback(
    (r: TRecent) => {
      if (!slug) return;
      const next = [r, ...readRecent(slug).filter((x) => x.id !== r.id)].slice(0, RECENT_MAX);
      writeJson(recentKey(slug), next);
      setRecent(next);
    },
    [slug]
  );

  const rememberAsk = useCallback(
    (q: string) => {
      if (!slug) return;
      const next = [q, ...readAsks(slug).filter((x) => x !== q)].slice(0, ASKS_MAX);
      writeJson(asksKey(slug), next);
      setRecentAsks(next);
    },
    [slug]
  );

  const go = useCallback(
    (url: string, newTab: boolean) => {
      if (newTab) {
        window.open(url, "_blank", "noopener");
        return;
      }
      close();
      router.push(url);
    },
    [close, router]
  );

  const openResult = useCallback(
    (r: TBarsoulSearchResult, newTab: boolean) => {
      const ident = `${r.project_identifier}-${r.sequence_id}`;
      remember({ id: r.id, ident, name: r.name });
      go(`/${slug}/browse/${ident}/${r.comment_id ? `#comment-${r.comment_id}` : ""}`, newTab);
    },
    [slug, remember, go]
  );

  const openRecent = useCallback(
    (r: TRecent, newTab: boolean) => {
      remember(r);
      go(`/${slug}/browse/${r.ident}/`, newTab);
    },
    [slug, remember, go]
  );

  const openSource = useCallback((s: TBarsoulAskSource, newTab = false) => openResult(s, newTab), [openResult]);

  /**
   * 问一轮。continueThread=false → 新线程; true → 接在现有线程后面(追问)。
   * dropLast=true: 重问出错的最后一轮(把它从线程里换掉)。
   * 追问时: prev_q 让检索带上前文(「那他呢」这种短追问单独搜不到东西), history 给模型当上下文。
   */
  const ask = useCallback(
    async (q: string, continueThread: boolean, dropLast = false) => {
      if (!slug || !q) return;
      const seq = ++askSeqRef.current;
      let base = continueThread ? thread.filter((x) => x.status !== "running") : [];
      if (dropLast) base = base.slice(0, -1);
      const idx = base.length;
      const prev = base.length > 0 ? base[base.length - 1] : undefined;
      const history: TBarsoulAskTurn[] = base
        .filter((x) => x.status === "done")
        .slice(-HISTORY_TURNS)
        .flatMap((x) => [
          { role: "user" as const, content: x.q },
          { role: "assistant" as const, content: x.reply },
        ]);
      const patch = (p: Partial<TTurn>) =>
        setThread((ts) => (seq === askSeqRef.current ? ts.map((x, i) => (i === idx ? { ...x, ...p } : x)) : ts));

      setAnswerView(true);
      setFollowup("");
      setThreadAt(Date.now());
      setThread([...base, { q, status: "running", sources: [], reply: "", followups: [] }]);
      if (!continueThread) rememberAsk(q);
      try {
        const start = await barsoulSearchService.ask(slug, q, lang, { history, prevQ: prev?.q, filters });
        if (seq !== askSeqRef.current) return;
        if (start.status === "no_sources") {
          patch({ status: "no_sources" });
          return;
        }
        patch({ sources: start.sources });
        const t0 = Date.now();
        while (seq === askSeqRef.current && Date.now() - t0 < ASK_TIMEOUT_MS) {
          await new Promise((r) => window.setTimeout(r, ASK_POLL_MS));
          if (seq !== askSeqRef.current) return;
          const p = await barsoulSearchService.askPoll(slug, start.job_id);
          if (seq !== askSeqRef.current) return;
          if (p.status === "done") {
            patch({ status: "done", reply: p.reply ?? "", followups: (p.followups ?? []).slice(0, 3) });
            setThreadAt(Date.now());
            return;
          }
          if (p.status !== "running") break;
        }
        patch({ status: "error" });
      } catch {
        patch({ status: "error" });
      }
    },
    [slug, lang, thread, filters, rememberAsk]
  );

  // 出错的那轮原样重问(接在它之前的线程后面)
  const retryLast = useCallback(() => {
    const last = thread[thread.length - 1];
    if (last) void ask(last.q, true, true);
  }, [thread, ask]);

  const vote = useCallback(
    (idx: number, v: "up" | "down") => {
      const turn = thread[idx];
      if (!turn || turn.vote || !slug) return;
      setThread((ts) => ts.map((x, i) => (i === idx ? { ...x, vote: v } : x)));
      barsoulSearchService
        .feedback(slug, {
          vote: v,
          q: turn.q,
          reply: turn.reply,
          sources: turn.sources.map((s) => s.ident),
          lang,
          turn: idx,
        })
        .catch(() => {
          /* 反馈只是日志, 失败不打扰用户 */
        });
    },
    [thread, slug, lang]
  );

  // D7: 在那张卡的私聊里接着聊 —— 只把问答放进草稿, 用户自己决定发不发
  const handoff = useCallback(
    (turn: TTurn) => {
      const src = handoffTarget(turn);
      if (!src) return;
      const draft = t("search_overlay.handoff_draft", { q: turn.q, a: stripCitations(turn.reply) });
      try {
        window.localStorage.setItem(`barsoul.aichan.draft:${src.id}`, draft);
      } catch {
        /* 写不进草稿也照样跳过去 */
      }
      requestReopen(src.id);
      remember({ id: src.id, ident: src.ident, name: src.name });
      go(`/${slug}/browse/${src.ident}/`, false);
    },
    [t, remember, go, slug]
  );

  const newSearch = () => {
    resetThread();
    setQuery("");
    setChips([]);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const backToSearch = () => {
    setAnswerView(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const pickChip = (c: TChip) => {
    setChips((cs) => [...cs, c]);
    // 把输入末尾的 @token 去掉, 保留前面打过的关键字
    setQuery((q) => q.replace(AT_RE, "$1"));
    setActive(0);
    inputRef.current?.focus();
  };

  const removeChip = (i: number) => {
    setChips((cs) => cs.filter((_, j) => j !== i));
    inputRef.current?.focus();
  };

  const handleChange = (value: string) => {
    if (answerView) {
      setFollowup(value);
      return;
    }
    // D1/Q1: `>` 开头 = 交给原 Power-K 命令面板
    if (value.startsWith(">") && chips.length === 0) {
      close();
      window.setTimeout(() => togglePowerKModal(true), 0);
      return;
    }
    setQuery(value);
    if (AT_RE.test(value)) setActive(0);
  };

  const lastTurn = thread.length > 0 ? thread[thread.length - 1] : undefined;
  const threadBusy = lastTurn?.status === "running";

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      // 浮层里再按 ⌘K = 关; stopPropagation 防止 document 上的全局 handler 又把它打开
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.nativeEvent.isComposing) return; // IME 选字中的回车/方向键不抢
    if (answerView) {
      // 回答视图: 输入框=追问框; 回车接着问(上一轮还在答时不抢)
      const f = followup.trim();
      if (e.key === "Enter" && f && !threadBusy) {
        e.preventDefault();
        void ask(f, true);
      }
      return;
    }
    // 空输入里退格 = 删最后一个筛选
    if (e.key === "Backspace" && query === "" && chips.length > 0) {
      e.preventDefault();
      setChips((cs) => cs.slice(0, -1));
      return;
    }
    if (pickerOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (itemCount === 0) return;
        setActive((i) => (e.key === "ArrowDown" ? (i + 1) % itemCount : (i - 1 + itemCount) % itemCount));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        const c = pickerOptions[active];
        if (c) pickChip(c);
      }
      return;
    }
    if (e.key === "Tab" && askRow && !e.shiftKey) {
      e.preventDefault();
      void ask(trimmed, false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (itemCount === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % itemCount : (i - 1 + itemCount) % itemCount));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const newTab = e.metaKey || e.ctrlKey;
      if (showRecent) {
        const r = recent[active];
        if (r) openRecent(r, newTab);
      } else if (askRow && active === 0) {
        // 同一问题已有回答(线程首问) → 直接回到回答, 不重跑
        if (thread[0]?.q === trimmed && thread[0].status !== "error") setAnswerView(true);
        else void ask(trimmed, false);
      } else {
        const r = results[active - offset];
        if (r) openResult(r, newTab);
      }
    }
  };

  const clearRecent = () => {
    if (!slug) return;
    writeJson(recentKey(slug), []);
    setRecent([]);
    inputRef.current?.focus();
  };

  const matchLabel = (m: string) =>
    m === "id"
      ? t("search_overlay.match_id")
      : m === "keyword"
        ? t("search_overlay.match_keyword")
        : t("search_overlay.match_semantic");

  const kbd = "rounded border border-subtle-1 px-1";
  const rowCls = (on: boolean) =>
    cn("flex w-full items-center gap-3 border-l-2 border-transparent px-4 text-left", {
      "border-accent-strong bg-layer-1-hover": on,
    });

  const renderTurn = (turn: TTurn, idx: number) => {
    const isLast = idx === thread.length - 1;
    const target = turn.status === "done" ? handoffTarget(turn) : undefined;
    return (
      <div
        key={idx}
        ref={isLast ? lastTurnRef : undefined}
        className={cn("scroll-mt-2 py-3", { "border-t border-subtle-1": idx > 0 })}
      >
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-primary" />
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-13 font-medium break-words text-primary">{turn.q}</div>
            {turn.status === "running" && (
              <div className="flex items-center gap-2 text-13 text-tertiary">
                <Loader className="size-3.5 animate-spin" />
                {t("search_overlay.ask_thinking")}
              </div>
            )}
            {turn.status === "done" && <Reply turn={turn} onOpen={(s) => openSource(s)} />}
            {turn.status === "no_sources" && (
              <div className="text-13 text-secondary">{t("search_overlay.ask_no_sources")}</div>
            )}
            {turn.status === "error" && (
              <div className="flex items-center gap-3 text-13 text-secondary">
                {t("search_overlay.ask_error")}
                {isLast && (
                  <button
                    type="button"
                    onClick={retryLast}
                    className="flex items-center gap-1 text-accent-primary hover:underline"
                  >
                    <RotateCcw className="size-3.5" />
                    {t("search_overlay.retry")}
                  </button>
                )}
              </div>
            )}

            {/* 出处: 最新一轮完整列出, 之前的轮次只留紧凑编号 */}
            {turn.sources.length > 0 && !isLast && (
              <div className="mt-2 flex flex-wrap gap-1">
                {turn.sources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.name}
                    onClick={(e) => openSource(s, e.metaKey || e.ctrlKey)}
                    className="flex items-center gap-1 rounded bg-layer-3 px-1.5 py-0.5 text-11 text-secondary hover:text-primary"
                  >
                    <span className="font-mono text-accent-primary">{s.n}</span>
                    <span className="font-mono">{s.ident}</span>
                  </button>
                ))}
              </div>
            )}
            {turn.sources.length > 0 && isLast && (
              <div className="mt-4">
                <div className="mb-1 text-11 font-medium text-tertiary">{t("search_overlay.ask_sources")}</div>
                {turn.sources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={(e) => openSource(s, e.metaKey || e.ctrlKey)}
                    title={t("search_overlay.ask_open_source")}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-layer-1-hover"
                  >
                    <span className="font-mono mt-0.5 shrink-0 rounded bg-accent-subtle px-1 text-11 leading-4 text-accent-primary">
                      {s.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-mono shrink-0 text-12 text-tertiary">{s.ident}</span>
                        <span className={cn("truncate text-13", isDone(s) ? "text-tertiary" : "text-primary")}>
                          {s.name}
                        </span>
                        {s.archived && <Archive className="size-3 shrink-0 text-placeholder" />}
                        {s.comment_id && <MessageSquare className="size-3 shrink-0 text-placeholder" />}
                      </span>
                      {s.snippet && (
                        <span className="mt-0.5 line-clamp-1 block text-12 text-secondary">{s.snippet}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* 反馈 + 衔接私聊 */}
            {turn.status === "done" && (
              <div className="mt-3 flex flex-wrap items-center gap-1">
                {turn.vote ? (
                  <span className="flex items-center gap-1 px-1 text-11 text-tertiary">
                    {turn.vote === "up" ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
                    {t("search_overlay.feedback_thanks")}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => vote(idx, "up")}
                      title={t("search_overlay.feedback_up")}
                      className="rounded p-1 text-placeholder hover:bg-layer-transparent-hover hover:text-primary"
                    >
                      <ThumbsUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => vote(idx, "down")}
                      title={t("search_overlay.feedback_down")}
                      className="rounded p-1 text-placeholder hover:bg-layer-transparent-hover hover:text-primary"
                    >
                      <ThumbsDown className="size-3.5" />
                    </button>
                  </>
                )}
                {isLast && target && (
                  <button
                    type="button"
                    onClick={() => handoff(turn)}
                    className="ml-auto flex items-center gap-1.5 rounded-md border border-subtle-1 px-2 py-1 text-12 text-secondary hover:bg-layer-1-hover hover:text-primary"
                  >
                    <MessagesSquare className="size-3.5" />
                    {t("search_overlay.handoff", { ident: target.ident })}
                  </button>
                )}
              </div>
            )}

            {/* 建议追问(只在最新一轮) */}
            {isLast && turn.status === "done" && turn.followups.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-11 font-medium text-tertiary">{t("search_overlay.followups")}</div>
                <div className="flex flex-col items-start gap-1">
                  {turn.followups.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => void ask(f, true)}
                      className="flex max-w-full items-center gap-1.5 rounded-md bg-layer-2 px-2 py-1 text-left text-12 text-secondary hover:bg-layer-1-hover hover:text-primary"
                    >
                      <CornerDownLeft className="size-3 shrink-0 -scale-x-100 text-placeholder" />
                      <span className="truncate">{f}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Transition.Root show={isSearchOverlayOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={close} initialFocus={inputRef}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-150"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-backdrop backdrop-blur-sm transition-opacity" />
        </Transition.Child>
        <div className="fixed inset-0 z-30 flex justify-center p-2 sm:px-6 sm:pt-[10vh] sm:pb-6">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0 sm:scale-[0.98]"
            enterTo="opacity-100 sm:scale-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100 sm:scale-100"
            leaveTo="opacity-0 sm:scale-[0.98]"
          >
            <Dialog.Panel
              data-prevent-outside-click="true"
              className="flex max-h-full min-h-0 w-full max-w-3xl flex-col self-start overflow-hidden rounded-lg border border-subtle-1 bg-surface-1 shadow-raised-200 sm:max-h-[75vh]"
            >
              {/* 输入框: 始终在顶部(D8 回答视图里它就是追问框) */}
              <div className="flex shrink-0 items-center gap-3 border-b border-subtle-1 px-4 py-3">
                {answerView ? (
                  threadBusy ? (
                    <Loader className="size-4 shrink-0 animate-spin text-accent-primary" />
                  ) : (
                    <Sparkles className="size-4 shrink-0 text-accent-primary" />
                  )
                ) : loading ? (
                  <Loader className="size-4 shrink-0 animate-spin text-placeholder" />
                ) : (
                  <Search className="size-4 shrink-0 text-placeholder" />
                )}
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {!answerView &&
                    chips.map((c, i) => (
                      <span
                        key={`${c.kind}:${c.value}`}
                        className="flex max-w-[12rem] shrink-0 items-center gap-1 rounded bg-accent-subtle py-0.5 pr-0.5 pl-1.5 text-12 text-accent-primary"
                      >
                        {c.kind === "assignee" ? (
                          <User className="size-3 shrink-0" />
                        ) : (
                          <CircleDot className="size-3 shrink-0" />
                        )}
                        <span className="truncate">{c.label}</span>
                        <button
                          type="button"
                          onClick={() => removeChip(i)}
                          className="rounded p-0.5 hover:bg-accent-primary hover:text-on-color"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  <input
                    ref={inputRef}
                    type="text"
                    value={answerView ? followup : query}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t(answerView ? "search_overlay.followup_placeholder" : "search_overlay.placeholder")}
                    // iOS: font-size<16px 会触发聚焦放大 → 手机 16px
                    className="min-w-[8rem] flex-1 bg-transparent text-16 text-primary outline-none placeholder:text-placeholder sm:text-14"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                {(answerView ? followup : query) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (answerView) setFollowup("");
                      else setQuery("");
                      inputRef.current?.focus();
                    }}
                    className="shrink-0 rounded p-0.5 text-placeholder hover:bg-layer-transparent-hover hover:text-primary"
                  >
                    <X className="size-4" />
                  </button>
                )}
                <kbd className="hidden shrink-0 rounded border border-subtle-1 px-1.5 py-0.5 text-11 text-tertiary sm:block">
                  Esc
                </kbd>
              </div>

              {/* 结果区 */}
              <div ref={listRef} className="vertical-scrollbar scrollbar-sm min-h-0 flex-1 overflow-y-auto py-2">
                {answerView && thread.length > 0 ? (
                  <div className="px-4">
                    <div className="flex items-center justify-between py-1">
                      <button
                        type="button"
                        onClick={backToSearch}
                        className="flex items-center gap-1 text-12 text-tertiary hover:text-primary"
                      >
                        <ArrowLeft className="size-3.5" />
                        {t("search_overlay.ask_back")}
                      </button>
                      <button
                        type="button"
                        onClick={newSearch}
                        className="flex items-center gap-1 text-12 text-tertiary hover:text-primary"
                      >
                        <SquarePen className="size-3.5" />
                        {t("search_overlay.new_search")}
                      </button>
                    </div>
                    {thread.map(renderTurn)}
                    <div className="pt-1 pb-2 text-11 text-tertiary">{t("search_overlay.ask_readonly")}</div>
                  </div>
                ) : pickerOpen ? (
                  <>
                    <div className="px-4 py-1 text-11 font-medium text-tertiary">
                      {t("search_overlay.filter_title")}
                    </div>
                    {pickerOptions.map((c, i) => (
                      <button
                        key={`${c.kind}:${c.value}`}
                        type="button"
                        data-idx={i}
                        onMouseMove={() => setActive(i)}
                        onClick={() => pickChip(c)}
                        className={cn(rowCls(i === active), "py-1.5")}
                      >
                        {c.kind === "assignee" ? (
                          <User className="size-3.5 shrink-0 text-placeholder" />
                        ) : (
                          <CircleDot className="size-3.5 shrink-0 text-placeholder" />
                        )}
                        <span className="shrink-0 text-11 text-tertiary">
                          {t(c.kind === "assignee" ? "search_overlay.filter_assignee" : "search_overlay.filter_state")}
                        </span>
                        <span className="truncate text-13 text-primary">{c.label}</span>
                      </button>
                    ))}
                    {pickerOptions.length === 0 && (
                      <div className="px-4 py-6 text-center text-13 text-tertiary">
                        {t("search_overlay.filter_empty")}
                      </div>
                    )}
                  </>
                ) : showRecent ? (
                  <>
                    {thread.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setAnswerView(true)}
                        className="mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-2 rounded-md border border-subtle-1 px-3 py-2 text-left hover:bg-layer-1-hover"
                      >
                        <MessagesSquare className="size-4 shrink-0 text-accent-primary" />
                        <span className="shrink-0 text-12 text-tertiary">{t("search_overlay.back_to_thread")}</span>
                        <span className="truncate text-13 text-primary">{thread[0].q}</span>
                      </button>
                    )}
                    {recent.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center justify-between px-4 py-1">
                          <span className="text-11 font-medium text-tertiary">{t("search_overlay.recent")}</span>
                          <button
                            type="button"
                            onClick={clearRecent}
                            className="text-11 text-tertiary hover:text-primary"
                          >
                            {t("search_overlay.clear_recent")}
                          </button>
                        </div>
                        {recent.map((r, i) => (
                          <button
                            key={r.id}
                            type="button"
                            data-idx={i}
                            onMouseMove={() => setActive(i)}
                            onClick={(e) => openRecent(r, e.metaKey || e.ctrlKey)}
                            className={cn(rowCls(i === active), "py-1.5")}
                          >
                            <Clock className="size-3.5 shrink-0 text-placeholder" />
                            <span className="font-mono shrink-0 text-12 text-tertiary">{r.ident}</span>
                            <span className="truncate text-13 text-primary">{r.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {recentAsks.length > 0 && (
                      <div className="mb-2">
                        <div className="px-4 py-1 text-11 font-medium text-tertiary">
                          {t("search_overlay.recent_asks")}
                        </div>
                        {recentAsks.map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => {
                              setQuery(q);
                              void ask(q, false);
                            }}
                            className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-layer-1-hover"
                          >
                            <Sparkles className="size-3.5 shrink-0 text-placeholder" />
                            <span className="truncate text-13 text-secondary">{q}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="px-4 py-1 text-11 font-medium text-tertiary">{t("search_overlay.tips")}</div>
                    <ul className="space-y-1 px-4 pb-1 text-12 text-secondary">
                      <li>{t("search_overlay.tip_id")}</li>
                      <li>{t("search_overlay.tip_semantic")}</li>
                      <li>{t("search_overlay.tip_filter")}</li>
                      <li>{t("search_overlay.tip_cmd")}</li>
                    </ul>
                  </>
                ) : (
                  <>
                    {data?.degraded && (
                      <div className="mx-4 mb-2 rounded-md bg-warning-subtle px-3 py-1.5 text-12 text-warning-primary">
                        {t("search_overlay.degraded")}
                      </div>
                    )}
                    {askRow && (
                      <button
                        type="button"
                        data-idx={0}
                        onMouseMove={() => setActive(0)}
                        onClick={() => void ask(trimmed, false)}
                        className={cn(rowCls(active === 0), "mb-1 py-2")}
                      >
                        <Sparkles className="size-4 shrink-0 text-accent-primary" />
                        <span className="min-w-0 flex-1 truncate text-13 text-primary">
                          <span className="text-accent-primary">{t("search_overlay.ask_prefix")}</span>
                          {trimmed}
                        </span>
                        <kbd className="hidden shrink-0 rounded border border-subtle-1 px-1.5 py-0.5 text-11 text-tertiary sm:block">
                          {active === 0 ? "↵" : t("search_overlay.ask_tab")}
                        </kbd>
                      </button>
                    )}
                    {results.length > 0 && (
                      <div className="px-4 py-1 text-11 font-medium text-tertiary">{t("search_overlay.results")}</div>
                    )}
                    {results.map((r, j) => {
                      const i = j + offset;
                      const done = isDone(r);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          data-idx={i}
                          onMouseMove={() => setActive(i)}
                          onClick={(e) => openResult(r, e.metaKey || e.ctrlKey)}
                          className={cn(
                            "flex w-full flex-col gap-0.5 border-l-2 border-transparent px-4 py-2 text-left",
                            { "border-accent-strong bg-layer-1-hover": i === active }
                          )}
                        >
                          <div className="flex w-full min-w-0 items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: r.state_color ?? "transparent" }}
                              title={r.state_name ?? ""}
                            />
                            <span className="font-mono shrink-0 text-12 text-tertiary">
                              {r.project_identifier}-{r.sequence_id}
                            </span>
                            <span className={cn("min-w-0 truncate text-13", done ? "text-tertiary" : "text-primary")}>
                              <Highlight text={r.name} terms={terms} />
                            </span>
                            <span className="ml-auto flex shrink-0 items-center gap-1">
                              {r.archived && (
                                <span className="flex items-center gap-0.5 rounded bg-layer-3 px-1.5 py-0.5 text-11 text-tertiary">
                                  <Archive className="size-3" />
                                  {t("search_overlay.archived")}
                                </span>
                              )}
                              {!r.archived && done && r.state_name && (
                                <span className="rounded bg-layer-3 px-1.5 py-0.5 text-11 text-tertiary">
                                  {r.state_name}
                                </span>
                              )}
                              {r.match.map((m) => (
                                <span
                                  key={m}
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-11",
                                    m === "semantic"
                                      ? "bg-layer-3 text-secondary"
                                      : "bg-accent-subtle text-accent-primary"
                                  )}
                                >
                                  {matchLabel(m)}
                                </span>
                              ))}
                            </span>
                          </div>
                          {r.snippet && (
                            <div className="flex min-w-0 items-start gap-1.5 pl-4 text-12 text-secondary">
                              {r.snippet_from === "comment" && (
                                <MessageSquare className="mt-0.5 size-3 shrink-0 text-placeholder" />
                              )}
                              <span className={cn("line-clamp-2 break-all", { "opacity-70": done })}>
                                <Highlight text={r.snippet} terms={terms} />
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                    {!loading && fresh && results.length === 0 && !error && (
                      <div className="px-4 py-8 text-center text-13 text-tertiary">{t("search_overlay.empty")}</div>
                    )}
                    {loading && results.length === 0 && (
                      <div className="px-4 py-8 text-center text-13 text-tertiary">{t("search_overlay.searching")}</div>
                    )}
                    {error && !loading && (
                      <div className="px-4 py-8 text-center text-13 text-tertiary">{t("search_overlay.empty")}</div>
                    )}
                  </>
                )}
              </div>

              {/* 底部键位提示(手机不显示) */}
              <div className="hidden shrink-0 items-center gap-4 border-t border-subtle-1 px-4 py-2 text-11 text-tertiary sm:flex">
                {answerView ? (
                  <span className="flex items-center gap-1">
                    <kbd className={kbd}>
                      <CornerDownLeft className="inline size-3" />
                    </kbd>
                    {t("search_overlay.hint_followup")}
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <kbd className={kbd}>↑</kbd>
                      <kbd className={kbd}>↓</kbd>
                      {t("search_overlay.hint_nav")}
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className={kbd}>
                        <CornerDownLeft className="inline size-3" />
                      </kbd>
                      {t("search_overlay.hint_open")}
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className={kbd}>⌘</kbd>
                      <kbd className={kbd}>
                        <CornerDownLeft className="inline size-3" />
                      </kbd>
                      {t("search_overlay.hint_newtab")}
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className={kbd}>@</kbd>
                      {t("search_overlay.hint_filter")}
                    </span>
                  </>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <kbd className={kbd}>&gt;</kbd>
                  {t("search_overlay.tip_cmd")}
                </span>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
});
