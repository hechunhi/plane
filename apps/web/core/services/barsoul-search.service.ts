/**
 * BARSOUL 2026-10-08: 全屏搜索浮层的数据源。
 * GET /api/workspaces/<slug>/barsoul-search/?q= —— 关键字(标题+描述+评论)+ plane-leann 语义,
 * 服务端 RRF 合并 + 权限过滤(详见 Django 侧 app/views/search/barsoul.py)。
 */
import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TBarsoulSearchMatch = "id" | "keyword" | "semantic";

export type TBarsoulSearchResult = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  project_name: string;
  state_name: string | null;
  state_group: string | null;
  state_color: string | null;
  archived: boolean;
  updated_at: string;
  match: TBarsoulSearchMatch[];
  snippet: string;
  snippet_from: "description" | "comment";
  comment_id: string | null;
};

export type TBarsoulSearchResponse = {
  q: string;
  exact: string | null;
  results: TBarsoulSearchResult[];
  degraded: boolean;
};

/** 问爱酱的出处卡(编号 n 对应回答里的 [n]) */
export type TBarsoulAskSource = TBarsoulSearchResult & { n: number; ident: string };

export type TBarsoulAskStart =
  | { status: "running"; job_id: string; sources: TBarsoulAskSource[]; degraded: boolean }
  | { status: "no_sources"; degraded: boolean };

export type TBarsoulAskPoll = {
  status: "running" | "done" | "error" | "not_found";
  reply?: string;
  followups?: string[];
  msg?: string;
  elapsed_s?: number;
};

export type TBarsoulAskTurn = { role: "user" | "assistant"; content: string };

/** P2 @筛选: assignee 可含 "me" */
export type TBarsoulSearchFilters = { assignee: string[]; state_group: string[] };

const filterParams = (q: string, f?: TBarsoulSearchFilters) => {
  // Django getlist 要的是 assignee=a&assignee=b(axios 默认会序列化成 assignee[]=)
  const p = new URLSearchParams();
  p.set("q", q);
  f?.assignee.forEach((a) => p.append("assignee", a));
  f?.state_group.forEach((g) => p.append("state_group", g));
  return p;
};

class BarsoulSearchService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async search(workspaceSlug: string, q: string, filters?: TBarsoulSearchFilters): Promise<TBarsoulSearchResponse> {
    return this.get(`/api/workspaces/${workspaceSlug}/barsoul-search/`, { params: filterParams(q, filters) }).then(
      (res) => res?.data
    );
  }

  // P1 问爱酱: 只读问答(资料由服务端按权限检索, 见 BarsoulSearchAskEndpoint)
  // P2: prev_q = 上一问(追问检索用), history = 本线程的问答, filters = @筛选
  async ask(
    workspaceSlug: string,
    q: string,
    lang: string,
    opts: { history?: TBarsoulAskTurn[]; prevQ?: string; filters?: TBarsoulSearchFilters } = {}
  ): Promise<TBarsoulAskStart> {
    return this.post(`/api/workspaces/${workspaceSlug}/barsoul-search/ask/`, {
      action: "ask",
      q,
      lang,
      history: opts.history ?? [],
      prev_q: opts.prevQ ?? "",
      assignee: opts.filters?.assignee ?? [],
      state_group: opts.filters?.state_group ?? [],
    }).then((res) => res?.data);
  }

  // D10 👍👎: 只记日志(ai-bot jsonl), 用来调检索
  async feedback(
    workspaceSlug: string,
    body: { vote: "up" | "down"; q: string; reply: string; sources: string[]; lang: string; turn: number }
  ): Promise<void> {
    await this.post(`/api/workspaces/${workspaceSlug}/barsoul-search/ask/`, { action: "feedback", ...body });
  }

  async askPoll(workspaceSlug: string, jobId: string): Promise<TBarsoulAskPoll> {
    return this.post(`/api/workspaces/${workspaceSlug}/barsoul-search/ask/`, { action: "poll", job_id: jobId }).then(
      (res) => res?.data
    );
  }
}

export const barsoulSearchService = new BarsoulSearchService();
