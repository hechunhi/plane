/**
 * BARSOUL: 智能表 / 项目数据库 service. 见 docs/architecture/smart-table-mvp.md.
 * 表/列/行 CRUD + 卡片「关联数据表」binding。照 keiri.service.ts(APIService)。
 */
import { API_BASE_URL } from "@plane/constants";
import type { TFileEntityInfo } from "@plane/types";
import { APIService } from "@/services/api.service";
import { FileService } from "@/services/file.service";

export type TSmartColumnType =
  | "text"
  | "number"
  | "single_select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "image"
  | "money"
  | "rating"
  | "progress"
  | "range"
  | "sparkline"
  | "user";

export type TSmartSelectOption = { v: string; color?: string };

// schema i18n 显示层 overlay: {lang: {name?, options?: {原值:译文}, labels?: {colkey:译文}}}; 原名=键, 翻译绝不改名
export type TSchemaI18n = Record<
  string,
  { name?: string; options?: Record<string, string>; labels?: Record<string, string> }
>;

export type TSmartColumn = {
  id: string;
  key: string;
  name: string;
  type: TSmartColumnType;
  source: "manual" | "plane" | "keiri" | "ai_bot";
  options: TSmartSelectOption[];
  required: boolean;
  position: number;
  width?: number | null;
  deriver?: string | null;
  i18n?: TSchemaI18n;
  // 字段级角色权限(0=不限 / 5=guest+ / 15=member+ / 20=仅admin)+ 此阅览者能否编辑(服务端算)
  acl_view?: number;
  acl_edit?: number;
  editable?: boolean;
};

export type TSmartFormField = { col: string; label?: string; required?: boolean };

export type TSmartForm = {
  id: string;
  name: string;
  fields: TSmartFormField[];
  position: number;
  i18n?: TSchemaI18n;
  // 列表端点附带: 使用此表单的卡片(数量 + ≤8 样例, 点击跳卡)
  binding_count?: number;
  bound_cards?: { issue: string; project: string; seq: number; name: string }[];
};

export type TSmartRow = {
  id: string;
  cells: Record<string, unknown>;
  status: "draft" | "committed";
  source_issue: string | null;
  source_issue_project?: string | null;
  position: number;
  incomplete?: boolean;
  updated_at: string | null;
};

export type TSmartTableSummary = {
  id: string;
  name: string;
  description: string;
  column_count: number;
  row_count: number;
  i18n?: TSchemaI18n;
  shared_workspace?: boolean;
  shared_projects?: string[];
  foreign?: boolean;
  folder?: string | null; // 所属文件夹 id(仅 home project 有意义)
};

export type TSmartTableFolder = { id: string; name: string; position: number };

export type TSmartTable = {
  id: string;
  name: string;
  description: string;
  shared_workspace?: boolean;
  shared_projects?: string[];
  foreign?: boolean;
  i18n?: TSchemaI18n;
  columns: TSmartColumn[];
  rows: TSmartRow[];
};

export type TBlueprint = {
  id: string;
  name: string;
  description: string;
  scope: string;
  enabled: boolean;
  title: string;
  latest_version: number | null;
};

export type TBlueprintVersionInfo = { version: number; published_at: string | null; changelog: string };

export type TBlueprintDetail = TBlueprint & {
  versions: TBlueprintVersionInfo[];
  draft: Record<string, unknown> | null;
  draft_version: number | null;
  refs: {
    tables: { name: string; forms: string[] }[];
    labels: string[];
    members?: { id: string; name: string }[]; // B-2b: 审批节点 approvers 下拉
  };
};

export type TBlueprintStage = {
  key: string;
  kind: "card" | "approval";
  label: string;
  status: "done" | "current" | "pending" | "cancelled";
  issue?: { id: string; sequence_id: number };
  cards?: number; // B-3e 并行度>1 时: 站内卡数
  cards_done?: number;
};

export type TBlueprintInstanceRow = {
  id: string;
  version: number;
  status: string;
  created_at: string | null;
  issue: { id: string; name: string; sequence_id: number; state: string | null };
  progress?: TBlueprintStage[] | null; // B-2c: 流程走到哪站(dag 蓝图才有)
};

export type TTableDeps = {
  rows: number;
  forms: number;
  views: number;
  bindings: { total: number; foreign: number; cards: string[] };
  blueprints: { name: string; version: number; project: string; foreign: boolean }[];
};

export type TFlowGuide = {
  form: string | null;
  wait: boolean;
  next: { label: string; assignees: string[]; approval?: boolean }[];
};

export type TIssueBlueprint =
  | { bound: false }
  | {
      bound: true;
      blueprint: string;
      title: string;
      version: number;
      status: string;
      instance_id: string;
      // B-2j 流程上下文(站卡/根卡通用)
      is_root: boolean;
      root_issue: { id: string; name: string; sequence_id: number; project_id: string };
      progress: TBlueprintStage[];
      current_key: string | null;
      guide: TFlowGuide | null;
    };

// B-4a 候选行: 比价等"运行时份数"的过程数据(全集留痕, 「采用」一份写主行)
export type TCandidate = {
  id: string;
  values: Record<string, unknown>;
  adopted: boolean;
  by?: string | null;
  at?: string;
};

// B-4c: 子树台账行汇总(总卡视角)
export type TSubtreeRowGroups = {
  groups: {
    table: { id: string; name: string; i18n?: TSchemaI18n };
    columns: TSmartColumn[];
    rows: {
      id: string;
      cells: Record<string, unknown>;
      status: string;
      source: { id: string; sequence_id: number; project: string; name: string };
    }[];
  }[];
};

export type TSmartBinding =
  | { bound: false }
  | {
      bound: true;
      committed: boolean;
      table: { id: string; name: string; i18n?: TSchemaI18n };
      form?: { id: string; name: string; i18n?: TSchemaI18n } | null;
      columns: TSmartColumn[];
      row: { id?: string; cells: Record<string, unknown> };
      rows?: TSmartRow[]; // Option A: extra rows per issue (candidates promoted to real SmartRows)
    };

class SmartTableService extends APIService {
  private fileService = new FileService();
  constructor() {
    super(API_BASE_URL);
  }

  // 图片单元格上传(走 Plane 资产管线, SMART_TABLE_CELL 类型, 归属 project)→ 返回可显示 URL
  async uploadCellImage(ws: string, pid: string, file: File): Promise<string | null> {
    try {
      const data = { entity_type: "SMART_TABLE_CELL" as TFileEntityInfo["entity_type"], entity_identifier: pid };
      const res = (await this.fileService.uploadWorkspaceAsset(ws, data, file)) as {
        asset_url?: string | null;
        asset_id?: string;
      };
      // B-2o: asset_url 兜底 — 创建响应曾对 SMART_TABLE_CELL 返 null(模型分支遗漏)→
      // 上传成功却静默不回填。后端已补分支; 此处按 asset_id 自拼防同类回归。
      if (res?.asset_url) return res.asset_url;
      if (res?.asset_id) return `/api/assets/v2/workspaces/${ws}/projects/${pid}/${res.asset_id}/`;
      return null;
    } catch {
      return null;
    }
  }

  private base(ws: string, pid: string) {
    return `/api/workspaces/${ws}/projects/${pid}/smart-tables`;
  }

  // ── tables ──
  async listTables(ws: string, pid: string): Promise<TSmartTableSummary[]> {
    return this.get(`${this.base(ws, pid)}/`)
      .then((r) => r?.data ?? [])
      .catch(() => []);
  }

  // ── folders(组织层)──
  private folderBase(ws: string, pid: string) {
    return `/api/workspaces/${ws}/projects/${pid}/smart-table-folders`;
  }
  async listFolders(ws: string, pid: string): Promise<TSmartTableFolder[]> {
    return this.get(`${this.folderBase(ws, pid)}/`)
      .then((r) => r?.data ?? [])
      .catch(() => []);
  }
  async createFolder(ws: string, pid: string, name: string): Promise<TSmartTableFolder | null> {
    return this.post(`${this.folderBase(ws, pid)}/`, { name })
      .then((r) => r?.data ?? null)
      .catch(() => null);
  }
  async renameFolder(ws: string, pid: string, fid: string, name: string): Promise<boolean> {
    return this.patch(`${this.folderBase(ws, pid)}/${fid}/`, { name })
      .then(() => true)
      .catch(() => false);
  }
  async deleteFolder(ws: string, pid: string, fid: string): Promise<boolean> {
    return this.delete(`${this.folderBase(ws, pid)}/${fid}/`)
      .then(() => true)
      .catch(() => false);
  }
  // 表归入/移出文件夹(folderId=null 移出)
  async moveTableToFolder(ws: string, pid: string, tid: string, folderId: string | null): Promise<boolean> {
    return this.patch(`${this.base(ws, pid)}/${tid}/`, { folder_id: folderId })
      .then(() => true)
      .catch(() => false);
  }

  async createTable(ws: string, pid: string, data: { name: string; description?: string }): Promise<TSmartTable> {
    return this.post(`${this.base(ws, pid)}/`, data).then((r) => r?.data);
  }

  async getTable(ws: string, pid: string, tid: string): Promise<TSmartTable> {
    return this.get(`${this.base(ws, pid)}/${tid}/`).then((r) => r?.data);
  }

  async updateTable(
    ws: string,
    pid: string,
    tid: string,
    data: Partial<{ name: string; description: string; shared_workspace: boolean; i18n: TSchemaI18n }>
  ): Promise<TSmartTable> {
    return this.patch(`${this.base(ws, pid)}/${tid}/`, data).then((r) => r?.data);
  }

  async deleteTable(ws: string, pid: string, tid: string, force = false): Promise<boolean> {
    return this.delete(`${this.base(ws, pid)}/${tid}/${force ? "?force=true" : ""}`)
      .then(() => true)
      .catch(() => false);
  }

  // 爱酱一键翻译 schema(默认只填空槽; overwrite 覆盖)→ {filled: {lang: n}, terms}
  async translateTable(
    ws: string,
    pid: string,
    tid: string,
    opts?: { targets?: string[]; overwrite?: boolean }
  ): Promise<{ filled: Record<string, number>; terms: number } | null> {
    return this.post(`${this.base(ws, pid)}/${tid}/translate/`, opts ?? {})
      .then((r) => r?.data ?? null)
      .catch(() => null);
  }

  // 删除/取消共享前的依赖报告(行/表单/视图/卡绑定/蓝图引用)
  async getTableDeps(ws: string, pid: string, tid: string): Promise<TTableDeps | null> {
    return this.get(`${this.base(ws, pid)}/${tid}/deps/`)
      .then((r) => r?.data ?? null)
      .catch(() => null);
  }

  // 共享范围: 全工作区 / 指定项目白名单 / 私有。收窄且有外部依赖时后端 409 + 报告 → {ok:false, ...};
  // confirm=true 二次确认放行(祖父化: 既有外项目绑定仍可经卡片写, 表不可见/不可新绑)
  async setTableShare(
    ws: string,
    pid: string,
    tid: string,
    scope: { shared_workspace: boolean; shared_projects: string[] },
    confirm: boolean
  ): Promise<{ ok: boolean; foreign_bindings?: number; blueprints?: { name: string; project: string }[] }> {
    return this.patch(`${this.base(ws, pid)}/${tid}/`, { ...scope, confirm_unshare: confirm })
      .then(() => ({ ok: true }))
      .catch((e) => {
        const deps = e?.response?.data?.deps ?? e?.deps ?? {};
        return { ok: false, foreign_bindings: deps.foreign_bindings ?? 0, blueprints: deps.blueprints ?? [] };
      });
  }

  // ── columns(运行时自定义 schema = B 路径)──
  async addColumn(ws: string, pid: string, tid: string, data: Partial<TSmartColumn>): Promise<TSmartColumn> {
    return this.post(`${this.base(ws, pid)}/${tid}/columns/`, data).then((r) => r?.data);
  }

  async addDerivedColumn(ws: string, pid: string, tid: string, deriver: string, name?: string): Promise<TSmartColumn> {
    return this.post(`${this.base(ws, pid)}/${tid}/columns/`, { deriver, name }).then((r) => r?.data);
  }

  async updateColumn(
    ws: string,
    pid: string,
    tid: string,
    cid: string,
    data: Partial<TSmartColumn>
  ): Promise<TSmartColumn> {
    return this.patch(`${this.base(ws, pid)}/${tid}/columns/${cid}/`, data).then((r) => r?.data);
  }

  async deleteColumn(ws: string, pid: string, tid: string, cid: string): Promise<void> {
    return this.delete(`${this.base(ws, pid)}/${tid}/columns/${cid}/`).then((r) => r?.data);
  }

  // ── 表单(录入视图 = 列子集 + 有序 + 别名 + 表单级必填)F-1 ──
  async listForms(ws: string, pid: string, tid: string): Promise<TSmartForm[]> {
    return this.get(`${this.base(ws, pid)}/${tid}/forms/`)
      .then((r) => r?.data ?? [])
      .catch(() => []);
  }

  async createForm(
    ws: string,
    pid: string,
    tid: string,
    data: { name: string; fields?: TSmartFormField[] }
  ): Promise<TSmartForm> {
    return this.post(`${this.base(ws, pid)}/${tid}/forms/`, data).then((r) => r?.data);
  }

  async updateForm(
    ws: string,
    pid: string,
    tid: string,
    fid: string,
    data: Partial<{ name: string; fields: TSmartFormField[]; position: number; i18n: TSchemaI18n }>
  ): Promise<TSmartForm> {
    return this.patch(`${this.base(ws, pid)}/${tid}/forms/${fid}/`, data).then((r) => r?.data);
  }

  async deleteForm(ws: string, pid: string, tid: string, fid: string): Promise<void> {
    return this.delete(`${this.base(ws, pid)}/${tid}/forms/${fid}/`).then((r) => r?.data);
  }

  // ── rows ──
  async addRow(ws: string, pid: string, tid: string, cells: Record<string, unknown>): Promise<TSmartRow> {
    return this.post(`${this.base(ws, pid)}/${tid}/rows/`, { cells }).then((r) => r?.data);
  }

  async updateRow(
    ws: string,
    pid: string,
    tid: string,
    rid: string,
    cells: Record<string, unknown>
  ): Promise<TSmartRow> {
    return this.patch(`${this.base(ws, pid)}/${tid}/rows/${rid}/`, { cells }).then((r) => r?.data);
  }

  async moveRow(ws: string, pid: string, tid: string, rid: string, position: number): Promise<TSmartRow> {
    return this.patch(`${this.base(ws, pid)}/${tid}/rows/${rid}/`, { position }).then((r) => r?.data);
  }

  async deleteRow(ws: string, pid: string, tid: string, rid: string): Promise<void> {
    return this.delete(`${this.base(ws, pid)}/${tid}/rows/${rid}/`).then((r) => r?.data);
  }

  // ── Blueprint 业务蓝图(B-1: 列表 + 实例化)──
  async listBlueprints(ws: string, pid: string): Promise<TBlueprint[]> {
    return this.get(`/api/workspaces/${ws}/projects/${pid}/blueprints/`)
      .then((r) => r?.data ?? [])
      .catch(() => []);
  }

  async instantiateBlueprint(
    ws: string,
    pid: string,
    bid: string,
    data: { title: string; customer?: string; seed_cells?: Record<string, unknown>; parent_issue?: string }
  ): Promise<{ instance_id: string; issue_id: string; sequence_id: number; refs: Record<string, string> } | null> {
    return this.post(`/api/workspaces/${ws}/projects/${pid}/blueprints/${bid}/instantiate/`, data)
      .then((r) => r?.data ?? null)
      .catch(() => null);
  }

  async createBlueprint(ws: string, pid: string, data: { name: string; title: string }): Promise<TBlueprint | null> {
    return this.post(`/api/workspaces/${ws}/projects/${pid}/blueprints/`, data)
      .then((r) => r?.data ?? null)
      .catch(() => null);
  }

  async getBlueprint(ws: string, pid: string, bid: string): Promise<TBlueprintDetail | null> {
    return this.get(`/api/workspaces/${ws}/projects/${pid}/blueprints/${bid}/`)
      .then((r) => r?.data ?? null)
      .catch(() => null);
  }

  async patchBlueprint(
    ws: string,
    pid: string,
    bid: string,
    data: Partial<{ title: string; enabled: boolean; definition: Record<string, unknown> }>
  ): Promise<boolean> {
    return this.patch(`/api/workspaces/${ws}/projects/${pid}/blueprints/${bid}/`, data)
      .then(() => true)
      .catch(() => false);
  }

  async publishBlueprint(
    ws: string,
    pid: string,
    bid: string,
    changelog?: string
  ): Promise<{ published?: number; details?: string[] }> {
    return this.post(`/api/workspaces/${ws}/projects/${pid}/blueprints/${bid}/publish/`, { changelog })
      .then((r) => r?.data ?? {})
      .catch((e) => ({ details: e?.details ?? e?.response?.data?.details ?? ["publish failed"] }));
  }

  async listBlueprintInstances(ws: string, pid: string, bid: string): Promise<TBlueprintInstanceRow[]> {
    // 路径用 runs/ 而非 instances/ — 上游 session 中间件对含 "instances" 的路径切 admin 会话(详见后端路由注释)
    return this.get(`/api/workspaces/${ws}/projects/${pid}/blueprints/${bid}/runs/`)
      .then((r) => r?.data ?? [])
      .catch(() => []);
  }

  async getIssueBlueprint(ws: string, pid: string, iid: string): Promise<TIssueBlueprint> {
    return this.get(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/blueprint-instance/`)
      .then((r) => r?.data ?? { bound: false })
      .catch(() => ({ bound: false }) as TIssueBlueprint);
  }

  // ── 每用户视图配置(过滤/汇总/着色/行高 持久化, 按用户隔离)──
  async getMyView(ws: string, pid: string, tid: string): Promise<Record<string, unknown>> {
    return this.get(`${this.base(ws, pid)}/${tid}/my-view/`)
      .then((r) => r?.data?.config ?? {})
      .catch(() => ({}));
  }

  async saveMyView(ws: string, pid: string, tid: string, config: Record<string, unknown>): Promise<void> {
    return this.put(`${this.base(ws, pid)}/${tid}/my-view/`, { config })
      .then((r) => r?.data)
      .catch(() => undefined);
  }

  // ── 卡片「关联数据表」binding + 自动表单 ──
  async getBinding(ws: string, pid: string, iid: string): Promise<TSmartBinding> {
    return this.get(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/smart-table-binding/`)
      .then((r) => r?.data)
      .catch(() => ({ bound: false }) as TSmartBinding);
  }

  // B-4c: 子树台账行汇总(总卡一屏看全部子任务状态)
  async getSubtreeRows(ws: string, pid: string, iid: string): Promise<TSubtreeRowGroups> {
    return this.get(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/smart-subtree-rows/`)
      .then((r) => r?.data ?? { groups: [] })
      .catch(() => ({ groups: [] }));
  }

  // B-3e 管理员流程干预(Temporal Update 同步回执; 拒绝原因在 error)
  async flowIntervene(
    ws: string,
    pid: string,
    iid: string,
    body: { verb: "set_parallelism" | "skip"; key: string; n?: number; reason: string }
  ): Promise<{ ok: boolean; msg?: string; error?: string }> {
    return this.post(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/flow-intervene/`, body)
      .then((r) => r?.data ?? { ok: false })
      .catch((e) => ({ ok: false, error: e?.response?.data?.error || e?.error || "rejected" }));
  }

  // Option A: 候选行已提升为 SmartRow — upsert(增改)/delete → {rows}
  async candidatesAction(
    ws: string,
    pid: string,
    iid: string,
    body:
      | { action: "upsert"; candidate: { id?: string; values: Record<string, unknown> } }
      | { action: "delete"; id: string }
  ): Promise<{ rows: TSmartRow[] } | null> {
    return this.post(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/smart-table-binding/candidates/`, body)
      .then((r) => r?.data ?? null)
      .catch(() => null);
  }

  async setBinding(ws: string, pid: string, iid: string, tableId: string, rowId?: string): Promise<TSmartBinding> {
    return this.put(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/smart-table-binding/`, {
      table_id: tableId,
      ...(rowId ? { row_id: rowId } : {}),
    }).then((r) => r?.data);
  }

  async bindForm(ws: string, pid: string, iid: string, formId: string, rowId?: string): Promise<TSmartBinding> {
    return this.put(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/smart-table-binding/`, {
      form_id: formId,
      ...(rowId ? { row_id: rowId } : {}),
    }).then((r) => r?.data);
  }

  async saveBindingRow(ws: string, pid: string, iid: string, cells: Record<string, unknown>): Promise<TSmartRow> {
    return this.patch(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/smart-table-binding/`, { cells }).then(
      (r) => r?.data
    );
  }

  async clearBinding(ws: string, pid: string, iid: string): Promise<void> {
    return this.delete(`/api/workspaces/${ws}/projects/${pid}/issues/${iid}/smart-table-binding/`).then((r) => r?.data);
  }
}

export const smartTableService = new SmartTableService();
