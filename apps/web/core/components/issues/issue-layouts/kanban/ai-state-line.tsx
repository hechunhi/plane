/**
 * BARSOUL: 派生卡片当前态 (Derived Issue State, DIS) — 看板卡顶状态行。
 *
 * 真相=issue+comments,派生=ai-bot(cloud Claude)写入的 issue_ai_states 表。
 * 本组件**只读**派生数据并渲染:球在谁手 / 下一步 / 是否停滞。
 *
 * 取数策略:每张卡独立 useIssueAIState() 请求,模块级 batcher 用 120ms 去抖把
 * 同一 project 的多卡 ID 合并成**一次** /ai-states 批量请求(50 卡=1 请求),
 * 不侵入看板既有数据流。失败安全:无派生/低置信/UNKNOWN → 不渲染(零布局影响)。
 * 详 docs/architecture/derived-issue-state-mvp.md。
 */
import { useEffect, useReducer } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";

export type DerivedIssueState = {
  issue_id: string;
  state: "ACTIVE" | "WAITING" | "STALE" | "UNKNOWN";
  ball: "SELF" | "OTHER" | null;
  current_actor: string | null;
  owner: string | null;
  next_action: string;
  due_date: string | null;
  stale_days: number;
  confidence: number;
  reasoning: string | null;
  model_used: string | null;
  updated_at: string | null;
};

// ── 模块级批量取数器 ────────────────────────────────────────────────────────
const _cache = new Map<string, DerivedIssueState | null>();
const _subs = new Map<string, Set<() => void>>();
const _pending = new Map<string, Set<string>>(); // projectId → issueIds
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _slug = "";

function _notify(issueId: string) {
  _subs.get(issueId)?.forEach((f) => f());
}

async function _flush() {
  const slug = _slug;
  const byProject = new Map(_pending);
  _pending.clear();
  for (const [projectId, idSet] of byProject) {
    const ids = Array.from(idSet);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      try {
        const r = await fetch(
          `/api/workspaces/${slug}/projects/${projectId}/issues/ai-states/?issues=${chunk.join(",")}`,
          { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } }
        );
        if (!r.ok) {
          chunk.forEach((id) => {
            if (!_cache.has(id)) _cache.set(id, null);
            _notify(id);
          });
          continue;
        }
        const data: Record<string, DerivedIssueState> = await r.json();
        chunk.forEach((id) => {
          _cache.set(id, data[id] ?? null);
          _notify(id);
        });
      } catch {
        chunk.forEach((id) => {
          if (!_cache.has(id)) _cache.set(id, null);
          _notify(id);
        });
      }
    }
  }
}

function _scheduleFlush(slug: string) {
  _slug = slug;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void _flush();
  }, 120);
}

export function useIssueAIState(
  slug: string | undefined,
  projectId: string | null | undefined,
  issueId: string | undefined
): DerivedIssueState | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!slug || !projectId || !issueId) return;
    let set = _subs.get(issueId);
    if (!set) {
      set = new Set();
      _subs.set(issueId, set);
    }
    set.add(force);
    if (!_cache.has(issueId)) {
      let ps = _pending.get(projectId);
      if (!ps) {
        ps = new Set();
        _pending.set(projectId, ps);
      }
      ps.add(issueId);
      _scheduleFlush(slug);
    }
    return () => {
      set?.delete(force);
    };
  }, [slug, projectId, issueId, force]);
  return issueId ? _cache.get(issueId) ?? null : null;
}

// ── 渲染决策(纯函数)─────────────────────────────────────────────────────
type Badge = { color: string; dot: string; head: string; next: string; tail: string };

function _dueLabel(due: string | null, isZh: boolean): string {
  if (!due) return "";
  try {
    const d = new Date(due + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return isZh ? "逾期" : "期限超過";
    if (days === 0) return isZh ? "今天" : "本日";
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "";
  }
}

function _badge(s: DerivedIssueState, isZh: boolean): Badge | null {
  // UNKNOWN / 低置信 → 不渲染(避免噪音误导)
  if (!s || s.state === "UNKNOWN" || (s.confidence ?? 0) < 0.4) return null;

  let color: string, dot: string, head: string;
  if (s.state === "STALE") {
    color = "text-[#64748b]";
    dot = "#94a3b8";
    head = isZh ? `停滞 ${s.stale_days}天` : `停滞 ${s.stale_days}日`;
  } else if (s.ball === "SELF") {
    color = "text-[#dc2626]";
    dot = "#dc2626";
    head = isZh ? "需要处理" : "対応必要";
  } else {
    // OTHER(球在对方)
    color = "text-[#b45309]";
    dot = "#d97706";
    const actor = s.current_actor || (isZh ? "对方" : "相手");
    head = isZh ? `等 ${actor}` : `${actor}待ち`;
  }
  return {
    color,
    dot,
    head,
    next: s.next_action,
    tail: s.state === "STALE" ? "" : _dueLabel(s.due_date, isZh),
  };
}

// ── 状态行组件 ──────────────────────────────────────────────────────────────
export function AIStateLine({
  issueId,
  projectId,
}: {
  issueId: string;
  projectId: string | null | undefined;
}) {
  const { workspaceSlug } = useParams();
  const { currentLocale } = useTranslation();
  const isZh = (currentLocale || "").toLowerCase().startsWith("zh");
  const s = useIssueAIState(workspaceSlug?.toString(), projectId, issueId);
  if (!s) return null;
  const b = _badge(s, isZh);
  if (!b) return null;

  const tooltip = [s.reasoning, s.next_action ? `→ ${s.next_action}` : ""]
    .filter(Boolean)
    .join("  ");

  return (
    <div
      title={tooltip || undefined}
      className={cn("flex items-center gap-1 text-11 leading-tight font-medium", b.color)}
    >
      <span
        className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: b.dot }}
      />
      <span className="shrink-0">{b.head}</span>
      {b.next && (
        <span className="truncate opacity-75 font-normal">· {b.next}</span>
      )}
      {b.tail && <span className="ml-auto shrink-0 opacity-75 font-normal">{b.tail}</span>}
    </div>
  );
}
