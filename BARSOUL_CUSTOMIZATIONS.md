# BARSOUL Plane 定制清单

> 本 fork = `hechunhi/plane`（基线 v1.3.0）。这份清单用于**升级 Plane 时核对 / re-apply**。
> 黄金法则：**所有代码定制都带 `# BARSOUL:` / `BARSOUL` 注释**。升级合并后执行
> `git grep -n "BARSOUL" -- apps/ packages/` 即可列出全部定制点核对是否还在 / 是否冲突。

最后更新: 2026-05-16

---

## 升级 SOP

1. `git fetch upstream && git log --oneline HEAD..upstream/<tag>` 看上游变更
2. 备份当前工作树定制：`git stash` 或先 commit（见下「未提交改动」）
3. merge/rebase 上游 tag
4. 冲突文件对照本清单逐个 re-apply（重点 §A）
5. `git grep -n BARSOUL -- apps/ packages/` 确认定制点数量与清单一致
6. `./build.sh` 重新构建 6 个镜像 → `compose ... up -d --force-recreate`
7. 冒烟：SSO 登录 / 愛ちゃん 评论 / 工单卡片 / UI 裁剪 / 备份监控告警

---

## §A. Plane fork 上游文件改动（升级会冲突，必须 re-apply）

### A1. 已提交 commits（`git log` 可见）

| commit | 内容 |
|---|---|
| `313c77b8` | **Authelia OIDC SSO provider** 新增（`authentication/provider/oauth/authelia.py` + `views/app/authelia.py` + urls + adapter）|
| `eed50c64` | Authelia provider: 内外 URL 分离（`AUTHELIA_INTERNAL_URL` 容器内调用）|
| `3ac03835` | Authelia provider: 注入 `X-Forwarded-{Proto,Host}`（Authelia 4.39 严格校验）|
| `84d0589f` | **SSO 用户 auto-join** 默认 workspace（`post_user_auth_workflow` / `default_workspace_auto_join`）|
| `f94fa3fa` | 修 pnpm 11 PATH bug（4 个 frontend Dockerfile）|
| `9a81d242` | `build.sh` — barsoul 本地镜像构建脚本 |

### A2. 未提交工作树改动（本会话/早期，**升级前先 commit 或记录**）

**SSO / 前端登录**
- `apps/api/plane/license/api/views/instance.py` — 加 `IS_AUTHELIA_ENABLED` 到 instance config 输出
- `apps/api/plane/utils/instance_config_variables/core.py` — `authelia_config_variables`
- `packages/types/src/instance/base.ts` — `is_authelia_enabled: boolean`
- `apps/web/core/hooks/oauth/core.tsx` — Authelia 登录按钮

**前端稳定性（SPA hydration）**
- `apps/web/app/entry.client.tsx` + `apps/web/app/root.tsx` — `clientLoader`+`HydrateFallback`（ssr:false SPA 的 #418/#423 hydration mismatch 真修）
- `apps/web/ce/store/issue/issue-details/activity.store.ts` — `uniqBy(id)` 去重（评论重复渲染）

**前端稳定性（接续）**
- `apps/web/core/layouts/auth-layout/project-wrapper.tsx` — intake-state useSWR 加 `shouldRetryOnError:false`（community 版无 intake，404 无限重试 → API/console 404 风暴真修）
- `apps/api/plane/app/views/state/base.py` `IntakeStateEndpoint.get` — 无 triage state 时返 **`200 {}` 而非 404**（「没 API 就补 API」：上游设计性 404，前端已优雅吞但浏览器必记 Console/Network；改 200 根除 DevTools intake-state 404 噪音。前端 `intakeStateResponse?.id` 偽 → 正常「无 Intake」无副作用）。**升级冲突点**
- `apps/web/core/store/state.store.ts` `fetchProjectIntakeState` — try/catch 吞 404/失败（防未捕获 rejection 连锁 #418/#423；与上面后端改互为防御）
- `apps/web/core/hooks/use-favorite-item-details.tsx` — `entity_data` 可能为 null（收藏指向已删除/失权实体）时 **嵌套解构 `entity_data:{logo_props}` 崩**（`null.logo_props` → 整个侧栏/layout 崩，2026-06-07 hechun 实测）。改安全访问 `favorite?.entity_data?.logo_props`（与同函数 name 行一致）。**上游 bug，非审批/DIS 引入**
- `apps/web/core/components/issues/issue-detail/issue-activity/activity/actions/helpers/issue-link.tsx` — 关联/父/链接活动指向**已删除** issue/project 时 `project_detail`/`issue_detail` 运行时为 null（类型谎称非空），L32-33/48 无守卫 deref → 崩整个活动流。加 `?.`（同文件 L37/L50 已守卫，这几行漏）。**防御性扫描发现的同类上游 bug**
- **根因备忘**：上游把 `favorite.entity_data`、`activity.{project,issue,actor}_detail` 等类型标注成**非空**但 API 运行时返 null → tsc 抓不到这类崩。彻底治理可把这些类型改 `| null` 强制全 reader 加守卫（大改，需 tsc 验，暂缓）

**数据一致性**
- `apps/api/plane/app/views/search/issue.py` — `.distinct()`（工单搜索 dup）
- `apps/api/plane/app/views/workspace/member.py` + `app/views/project/member.py` — `is_active=True` 过滤（@suspended user / member dup 根因：soft-delete 残留行）

**运维稳定性（关键 — 不 re-apply 会 worker 全挂）**
- `apps/api/plane/utils/telemetry.py` + `license/bgtasks/tracer.py` — 禁 Plane 遥测 phone-home（gRPC fork-unsafe，Celery prefork 永久 hang。`OTEL_ENABLED=1` 可恢复）
- `apps/api/plane/celery.py` — 禁 email notification beat（SMTP 未配 → ConnectionRefused 堵 worker；配 SMTP 后恢复）
- `apps/api/plane/middleware/logger.py` — 停 API 审计日志 enqueue（unregistered task 风暴）
- `apps/api/plane/api/views/issue.py` — API 评论传 `notification=True`（Ai bot @mention 进收件箱；上游漏传）

**UI 裁剪**
- `apps/web/styles/globals.css` — 末尾 3 段 `display:none`：① sidebar 底部 h-12 栏 ② 顶部 promo a.bg-layer-2 ③ `a[href*="/settings/billing"]`
- `apps/web/core/components/workspace/sidebar/help-section/root.tsx` — 帮助「?」菜单只留「键盘快捷键」+ 版本号

**爱酱发起审批入口（评论框去污染, 2026-06-06）**
- `apps/api/plane/app/views/issue/comment.py` — 新增 `IssueAIApprovalEndpoint`（认证代理 → ai-bot `/ai/invoke`|`/ai/compose-approval`，X-Cards-Token，actor=request.user.id 服务端解析）
- `apps/api/plane/app/views/__init__.py` — 导出 `IssueAIApprovalEndpoint`
- `apps/api/plane/app/urls/issue.py` — import + path `.../issues/<iid>/ai-approval/`
- `apps/web/core/components/comments/comment-create.tsx` — 挂载 `<AichanApprovalButton>`（projectId 存在时，评论框上方）
- `apps/web/core/components/comments/aichan-approval-button.tsx` — **新建**（非 upstream，不冲突）爱酱图标 + ModalCore 表单（主题/详情/审批人/模式）→ ai-approval 代理；全 i18n
- `packages/i18n/src/locales/{en,ja,zh-CN,zh-TW}/translations.ts` — 新增 `aichan_approval` namespace（27 keys，四语 parity，无 missing-key lint 须手核）
- env（`compose.local.yml` api + `plane.env`）: `CARDS_INTERNAL_TOKEN` + `AIBOT_URL`（后端→ai-bot 内部信任）
- 配套（非 fork source）: ai-bot `server.py` `/ai/invoke`+`/ai/compose-approval`；`approval.py` `LARK_REACHABLE=set()`（审批裁决去飞书，走 issue 内 barsoulCard）

**全站统一 emoji 选择器 → emoji-mart（升级唯一共享内核 EmojiRoot, 2026-06-07）**
- 全站 13 个 picker 入口（7 icon/logo + 6 reaction, 含 apps/space）都渲染同一个 `EmojiRoot`。把它**内核从 frimousse 换成 emoji-mart**，一处改、13 处全升级。内置: 最近使用/底部分类导航/搜索/肤色/暗色/多语言 chrome。
- 依赖: `packages/propel/package.json` +`@emoji-mart/data`+`@emoji-mart/react`+`emoji-mart` **-frimousse**；`apps/web/package.json` **-emoji-picker-react**（死依赖）。**改依赖后必重新生成并提交根 `pnpm-lock.yaml`**（两个 Dockerfile `--frozen-lockfile`，否则构建硬失败）。host 无 pnpm → 用 docker `node:20`+corepack 跑 `pnpm install --lockfile-only` 重生锁文件（不写 host node_modules）。
- `…/emoji-icon-picker/emoji/emoji.tsx`（**核心重写**）: `"use client"` + emoji-mart `<Picker>`；**保持 `onChange(emoji.native)` 契约**（下游 emojiToString + 13 caller 零改动）；`data={async()=>import("@emoji-mart/data")}` **懒加载**（~1.6MB 独立 chunk，严禁静态 import）；`dynamicWidth`/`navPosition=bottom`/`maxFrequentRows=2`/`previewPosition=none`/`skinTonePosition=search`。
- `…/emoji-icon-picker/emoji/emoji-i18n.ts`（**新文件**）: 自带 en/ja/zh chrome i18n（**完整对象 → 不触发 emoji-mart 的 CDN/jsdelivr，纯本地离线**）；运行时探 locale(`localStorage.userLanguage`/`<html lang>`)+theme(`data-theme` 含 dark)。**关键词搜索仍英文**（@emoji-mart/data 限制，同旧 frimousse，非回归）。
- `emoji-picker.tsx`（icon, 双 tab）: emoji tab 去外层 `h-80` 滚动（emoji-mart 自管）、icon tab 保留（per-tab className）。`emoji-reaction-picker.tsx`: 去 h-80 包裹 + 加 panel `onMouseDown/onClick/onKeyDown` 守卫（emoji-mart 搜索键不外泄 + 不塌 peek 面板, Escape 关）。
- `apps/web/styles/globals.css` + `apps/space/styles/globals.css`: `em-emoji-picker { --font-family:inherit; --border-radius:8px; width:100% }`（CSS 变量穿透 shadow DOM；仅此自定义元素命中）。
- **回收**了上一版临时「最近」层（被 emoji-mart 原生 Frequent 取代）: 删 `apps/web/core/hooks/use-recent-reactions.ts`、`quickReactions`/`handleQuick`/quick-row、两个评论文件的 recent 接线（display.tsx 顺带删未用的 `stringToEmoji` import，否则 oxlint `--deny-warnings` 卡 pre-commit）。
- **构建**: propel 同喂 web+space → **两个镜像都重建**（plane-frontend + plane-space, tag barsoul-1.3.0）。`docker compose build` 是 no-op。
- **tsc 备注**: `npx tsc -p apps/web/tsconfig.json` 单独跑 exit 1 且无诊断（缺 react-router typegen），别信其"clean"；真闸门是 `docker build` 的 `react-router build`。

**附件内联预览（图片/PDF/文本, 2026-06-07）**
- `apps/api/plane/app/views/issue/attachment.py` — issue attachment GET 支持 `?disposition=inline`（默认仍 `attachment` 下载, 权限不变）。PDF/文本 iframe 内联需要。**升级冲突点**
- `packages/types/src/issues/issue_attachment.ts` — `attributes.type?`（mime, 上游漏声明, 预览判定用）
- `packages/utils/src/attachment.ts` — `getAttachmentPreviewKind(mime, ext)` + `TAttachmentPreviewKind`
- `apps/web/core/components/issues/attachment/attachment-preview-modal.tsx` — **新建** ModalCore 灯箱（image=`<img>` / pdf·text=`<iframe ?disposition=inline>` + 下载/新标签兜底 + `data-prevent-outside-click`）
- `apps/web/core/components/issues/attachment/attachment-list-item.tsx` — 点击改派: 可预览→浮层, 否则下载
- 原理: `/api/assets` cookie 鉴权端点; `<img>`/`<iframe>` 忽略 Content-Disposition 内联渲染（同编辑器内嵌图先例）; svg 经 `<img>` 不执行脚本(安全)

**「（共有）」カード自動仕分け — 外部 API 端点（2026-06-09）**
> 用途: ai-bot(愛ちゃん)が「（共有）」カードをナレッジ Page 化 + アーカイブ退避し、
>       ユーザーの unarchive で自動 undo するための、token-auth(X-Api-Key=愛ちゃん)端点。
>       CE の v1 公開 API には Pages も issue archive も無いため新設。**升级冲突点**(全新文件优先)
- `apps/api/plane/api/views/page.py` — **新建** `PageListCreateAPIEndpoint`(POST 建 Project Page, html-only, owned_by=request.user=愛ちゃん, **`parent` 対応→ カテゴリ親ページの子ページとしてネスト**; Page tree は parent_id 駆動=base.py:65 再帰CTE, sub_pages_data は触らず) + `PageDetailAPIEndpoint`(DELETE 撤回用, 所有者限定)。app 层 `PageViewSet.create/destroy` を踏襲、`ProjectLitePermission` 再利用
- `apps/api/plane/api/urls/page.py` — **新建** 上記 2 端点の url(`.../projects/<pid>/pages/`, `.../pages/<page_id>/`)
- `apps/api/plane/api/views/issue.py` — 追加 `IssueArchiveUnarchiveAPIEndpoint`(POST=archive / DELETE=unarchive)。app `IssueArchiveViewSet` と異なり **state.group 制約なし**(Backlog の共有カードも archive 可)。issue_activity + realtime webhook_activity は app と同一
- `apps/api/plane/api/urls/work_item.py` — 追加 `.../work-items/<pk>/archive/`(POST+DELETE) + import
- `apps/api/plane/api/views/__init__.py` / `apps/api/plane/api/urls/__init__.py` — 上記 export + url 登録(`page_patterns`)
- 赤線: SoR 書込はこれら端点 + 愛ちゃん token のみ(ADR-015); permission は既存再利用; plane-mq 不動(ADR-003); ai-bot 側ロジックは `~/llm-tools/ai-bot/server.py` `handle_share_router`(fork 外)

---

## §B. 不在 fork source 内的 BARSOUL 定制（不冲突，但属全景）

> 升级 Plane 不影响这些，但环境迁移/重建时需要。

### B1. Plane DB 状态（非代码）
- `愛ちゃん` user（`ai@barsoul.jp`, is_bot=f, bot_type=ai-assistant）+ api_token(label=ai-bot) + workspace/project member
- 愛ちゃん avatar：`file_assets` cd9d9534… (USER_AVATAR) + `users.avatar_asset_id`
- Plane webhook `aa1c1b9f`（→ `host.docker.internal:8098` ai-bot, issue+issue_comment）
- `IS_AUTHELIA_ENABLED=1` instance_configurations
- soft-delete 残留行 is_active 修复（一次性 DML）

### B1b. 経理服务端化（keiri-api，新建，2026-05-17 起）
- `~/stack/keiri/PRODUCT_PLAN.md` — 最终规划（真相源=keiri-api / Go+PG / P0→P3）
- `~/stack/keiri/api/` — keiri-api Go 服务（system-of-record）+ `migrations/0001_init.sql` + `cmd/import`
- `~/stack/keiri/compose.yml` — `keiri-api:local` 容器（net `stack`）
- 共享 `postgres` 新增库 `keiri`（9 表）；minio 新增桶 `keiri`（凭证图/PDF）
- Caddyfile `keiri.barsoul.jp`：`/api/*`→keiri-api:8099，其余仍静态（P1 后退役静态）
- **P0 完成**：schema+导入+对照校验全绿（55 orders 等值 DATA.json）
- **P1 完成（big-bang 真相源切换）**：
  - dashboard `web/index.html`（fork 自旧 0_📊_売上台帳.html）5 个 I/O 原语改指 keiri-api：`imgSrc`→/api/assets、`bootApp`→GET /api/ledger、`writeBackData`→PUT /api/ledger、`writeImageToDir`→POST /api/assets、`appendActionLog`→POST /api/audit、删单→DELETE /api/assets（全带 `BARSOUL P1` 注释）
  - keiri-api 新增 `internal/{model,ledger,assets}` + 路由 ledger GET/PUT、assets GET/POST/DELETE、audit、内嵌 dashboard `/`
  - migrations 0002(channel)/0003(note_images) + 回填
  - Caddy `keiri.barsoul.jp` 全量反代 keiri-api（静态/srv/keiri+publish.sh 退役→`publish.sh.retired-P1`）
  - keiri-api compose 加 `plane_default` 网(minio) + `127.0.0.1:8099` host 口（Hermes/愛ちゃん 内部取数）
  - `~/.hermes/bin/keiri-ledger-export`+`keiri-payment-sentinel` 改读 `KEIRI_API/api/ledger`；ledger-export 兼写 GDrive `_archive/売上台帳_DATA_snapshot.json`（GDrive 降只读存档）
  - 待用户浏览器侧验证：Authelia 登录→dashboard→建/改单 PUT 回环
- **EPIC A 完成（破坏性·已备份）**：Plane 受注管理 以 keiri DB 为准重建
  - 删 48 脏 issue + 软删 54 污染 state；建 6 干净 state（引合い/受注未入金/入金済/出荷済/完了/取消，对齐 keiri 状态机）
  - 重建 55 issue（32 入金済+23 受注）；`keiri "order".plane_issue_id` 55/55 锚点
  - 脚本 `~/stack/keiri/api/cmd/epicA/rebuild.py`（幂等+429退避）；备份 `~/stack/keiri/_epicA_backup_*/`
  - migration 0001 的 `order.status` 枚举(受注/出荷/入金/完了/取消)即 Plane state 映射源
  - C1 现可安全触发（完了 state 唯一）
- **P2 完成（単票工房 AI 化）**：
  - `~/stack/keiri/tanpyo/`（rsync 自 GDrive `_AI単票工房`，仓库为真相源；GDrive 写 `_ARCHIVED_README.txt`）
  - keiri-api 加 `internal/doc`：`GET /api/doc/types`（13 类 schema/prompt/example）、`POST /api/doc`（存 document 行→回预填链接 `/tanpyo/<type>.html?doc=<id>`）、`GET /api/doc/:id`、`GET /tanpyo/*` 静态
  - `tanpyo/shared.js` 加 `BARSOUL P2` 补丁：`?doc=<id>` 自动从 keiri-api 取 JSON 渲染（一处覆盖 13 页，人工核对后 Print）
  - compose 挂 `./tanpyo:/srv/tanpyo:ro` + `TANPYO_DIR`；Caddy P1 全反代已覆盖（Authelia 保护）
  - 端到端验证全绿（13类/POST/GET/order关联/audit/静态/补丁）
- **C1 完成（ORD→完了 自动請求書）**：
  - keiri-api `internal/doc.InvoiceFromOrder` + `POST /api/orders/by-plane/{iid}/invoice`（plane_issue_id 逆查订单→构造 InvoiceJson→存 document→回预填链接；幂等复用）
  - `~/llm-tools/ai-bot/server.py`：常量 `KEIRI_API/KEIRI_PUBLIC/ORD_PROJECT_ID` + `_c1_complete()`；`handle_issue_state_change` 内 `project==ORD && grp==completed` 触发
  - E2E 验证：issue→完了→webhook→愛ちゃん 自动评论（補記台帳链接 + 請求書预填链接），测试数据已清
  - 依赖：EPIC A 锚点 + P2 doc API（均✅）；与 P1 浏览器写回环**无依赖**（C1 只读订单+写评论）
- **C1 重构（2026-05-17 用户澄清后）**：55 单皆历史已完成成交
  - keiri `order.status` 全 → `完了`；Plane 受注 55 issue 全 → `完了/完结`（kill-switch `~/.hermes/.c1_disabled` 关 C1 期间批量改，零评论刷屏，已验）
  - C1 触发点改对齐「収款前」：`handle_issue_state_change` 内 ORD 项目——
    `grp==unstarted(受注/未入金)` → `_c1_invoice_unpaid`（請求書催款链接）；
    `grp==completed(完了)` → `_c1_ledger_remind`（仅補記台帳，不再出請求書）
  - 新增 `handle_issue_created`（going-forward 受注创建即触发請求書）+ `_resolve_state_group`
  - keiri-api：`model.Order.Status`（附加字段，dashboard 忽略/Sync 不读/CASE 保 完了）；`ledger.Get` 取 status；`GET /api/orders/by-plane/{iid}`（轻量反查，補記用）
  - `keiri-payment-sentinel` 加 `status in (完了,入金,取消) → skip`（23 单不再误报未収；复跑 no pending）
  - 双路径 E2E 验证全绿（受注/未入金→請求書 ✓ 完了→補記 only ✓）
  - **已知预存限制**：ai-bot webhook 去重键 `issue:updated:<id>`（600s TTL）→ 同 issue 600s 内二次状态变更第二次被丢。going-forward 真实订单状态间隔远，不受影响；批量/快速连改才会命中（非本次引入，未扩范围修）
  - **批量副作用报备**：55 单批量改 完了 时，旧有「Lark 状态变更卡」推送照常触发 ~55 次（kill-switch 只挡 C1 函数未挡该卡）→ hechun 飞书被刷 55 卡，已发生不可撤回；后续如需可把该卡也纳入 kill-switch
- **C3 完成（全员对话出単票）**：
  - `~/llm-tools/weclaw-guard/server.py`：常量 `KEIRI_API/KEIRI_PUBLIC` + `_DOC_INTENT/_DOC_ACTION_HINTS/_detect_doc_type` + `call_doc_studio()`；`/v1/chat/completions` 内先于 plane_direct 命中
  - scope：請求書/合同/装箱单（invoice/contract/packing_list），全员；意图=単票名词+动作词（防误触）
  - 流程：拉 keiri `/api/doc/types` 的 prompt+schema → FAST_URL(gemma:8001) 产严格 JSON（缺字段按提示词追问，对话式）→ `POST /api/doc` → 回 `keiri.barsoul.jp` 预填链接
  - 无需改 plist（KEIRI 默认值即对）；E2E 验证：追问路径✓ 完整信息→链接✓ 按语言回复✓
  - guard plist `com.local.llm.guard.plist`（FAST/CODER→:8001 gemma-4-26b）

### B1c. P5 仕入/原価（★地基，2026-05-17）
- migration `0004_purchase.sql`：supplier / purchase_order / purchase_item + `sku_cost` view（仅 入荷+ 计成本）
- `internal/http/purchase.go`（inline-pgx，预建）：suppliers / purchases CRUD + 状态机 `poTransitionOK`（発注→入荷→検収→支払→完了 严格单步，非终态→取消；终态锁定）+ sku 加权均价；server.go 补 `GET /api/purchases/{id}` + `GET /api/order-margin/{id}`（毛利反查；**路径避 /api/orders/{id}/... 防 Go1.22 ServeMux 与 by-plane 冲突 panic**）
- ai-bot：`tool_keiri_list_unreceived` / `tool_keiri_create_purchase`（@愛ちゃん 可起票/查未入荷；走 KEIRI_API host）
- E2E 全验证：服务端复算 total ✓ / 状态机跳级·回退 409 ✓ / margin ✓ / 愛ちゃん 工具 ✓
- **遗留（后续）**：dashboard「仕入」Tab + 订单页毛利反查 UI（重 UI，附加非阻塞；后端+愛ちゃん 已兑现 ★地基价值）
- kill-switch 硬化：`~/.hermes/.c1_disabled` 现也挡 ai-bot Lark 状态卡（批量改状态零刷屏）

### B1d. P6 経営BI（依赖 P5，2026-05-17）
- `internal/http/analytics.go`（全派生无新表）：`GET /api/kpis`（受注/客数/売上/原価/粗利/粗利率/客単価/応収账龄分桶）+ `GET /api/analytics?dim=month|customer|sku`（各桶 rev/cost/gross/margin）
- 成本口径与 order-margin 一致（勾稽 purchase_item 优先，否则 sku_cost 加权均价）；多币种原值聚合 + `currency_note`（並币精算 P6+ 细化）
- ai-bot：`tool_keiri_kpis` / `tool_keiri_analytics`（@愛ちゃん 答「本月利益率?」）
- E2E 验证：kpis 55单/28客、analytics 月次5行+客户ranking、愛ちゃん工具 ✓
- 现 cost=0 margin=1 属正常（未录仕入；P5 起票后毛利变真）

### B1e. P7 物流追跡（2026-05-17）
- migration `0005_shipping.sql`：`order` 加 forwarder/tracking_no/customs_status(未/通関中/通関済)/ship_date/eta/track_token（不可猜随机，可置空失效）
- `internal/http/shipping.go`：承运商→官网外链表（SF/EMS/Yamato/佐川/日本郵便+17TRACK兜底，纯字符串零API）；`PATCH/GET /api/order-shipping/{id}`（首次设生成 token）；`GET /t/{token}` 客户只读 HTML 页（不暴露金额/明细）
- **Caddyfile keiri.barsoul.jp 改结构**：`@track path /t/*` → 免 Authelia 反代；其余 `handle{}` 内 import authelia（财务仍强保护）。实测 /t 200 免登录、/ 仍 302
- ai-bot：`tool_keiri_set_shipping` / `tool_keiri_track`
- 一单多包 shipment 子表 = P7+（当前单発送覆盖绝大多数）

### B1f. P8 CS 顧客360（roadmap 末项，2026-05-17）
- migration `0006_interaction.sql`：interaction 沟通史表（wechat/lark/mail/phone/other）
- `internal/http/customer.go`：`GET /api/customers`（rollup）、`GET /api/customer-overview/{name}`（注文+入金+粗利+配送中+単票+沟通史一坨，按 customer_name 聚合）、`POST /api/interactions`
- ai-bot：`tool_keiri_customer`（@愛ちゃん 答「这个客户现状」）
- E2E 全验证；测试数据全清，DB 终态：order55/item190/payment33/sku164，P5–P8 表空

> **roadmap 后端完结**：P0–P8 全部上线并 E2E 自验证。余 = keiri dashboard 重 UI 批次（仕入/経営/物流/顧客 Tab，**批在 P1 浏览器写回环用户亲验之后**）+ SOP Lark Wiki 侧线（零基建）+ P1 用户亲验（唯一硬阻塞）。

### B1g. Plane 评论「行动卡」审批（签名链接，2026-05-19）
- **背景**：Plane comment_html 仅静态 HTML 子集，无交互组件 → 真·按钮卡片不可能。用「卡片样式 HTML + HMAC 签名 `<a>` 链接」代替（同 P7 token 套路）。
- `~/llm-tools/ai-bot/approval.py`：`approve_sig/approve_link/fetch_chain`（HMAC=APPROVAL_LINK_SECRET 或 AI_BOT_WEBHOOK_SECRET；签 `no|approver_id|decision`，无 token 存储、防伪、approver_id 身分束缚）；`create_approval` 评论尾追加 blockquote 行动卡（每审批人 ✅承認/❌却下 签名链 + 🔗进捗閲覧）
- `~/llm-tools/ai-bot/server.py`：`GET /__approve`（验签→`approval.apply_decision(channel="Web")` 与 Lark/关键词同一引擎；view 只读链页）
- `~/stack/caddy/Caddyfile` tasks.barsoul.jp：`@approve path /__approve*` → `host.docker.internal:8098`(ai-bot)，catch-all 前，**无 Authelia**（签名即凭证）
- 安全模型：不可猜签名 + approver_id 绑定；闭单后 apply_decision 幂等拒绝=链接天然失效。**已知权衡**：评论里所有人可见各审批人链接，4 人可信小队 + 全程 audit/Plane 留痕可接受；私密投递仍走 Lark 卡片
- 验证：签名确定/决策&身份绑定、篡改→403、路由隔离、引擎接通全绿；**真实一单审查回环待用户实操**（同 P1，需活 Plane @mention + Bitable）

### B1h. cards 微服务 — 评论内交互卡片引擎（2026-05-19, v1）
- **架构**：薄缝 + 自有引擎。「威力在自有代码、Plane fork 压成一个冻结稳定缝」
- `~/stack/cards/`（新服务，Go/distroless，stack 网，host 127.0.0.1:8100；共享 postgres 库 `cards`：card/card_action_log）
  - `POST /api/cards` 愛ちゃん compose（声明式区块 spec → 存 + 回降级 embed_html）
  - 区块工具箱：header/kv/text/progress/chain/divider/link/actions（render.go）
  - `GET /c/{id}.{sig}` 渲染（runtime/?as=view 只读链）
  - `GET /__act?c&u&a&s` 签名动作 → 验签 → 路由域引擎
  - 签名：HMAC(CARDS_SIGN_SECRET, id|actor|act)，不可猜/防伪/actor 绑定；闭单引擎幂等拒=天然失效
- `~/llm-tools/ai-bot/server.py`：`POST /approval/decide`（X-Cards-Token 信任边界 → approval.apply_decision，与 Lark/关键词/__approve 同一引擎）
- `~/llm-tools/ai-bot/approval.py`：`compose_card()` + `create_approval` 改调 cards 引擎；**cards 不可达自动回退内联签名卡**（审查绝不中断）
- `~/stack/caddy/Caddyfile` tasks.barsoul.jp：`@cards path /__act* /c/*`→`cards:8100`（无 Authelia，签名=凭证），catch-all 前
- secrets：`CARDS_SIGN_SECRET`/`CARDS_INTERNAL_TOKEN`（~/stack/.env + ~/.hermes/.secrets.env，须一致）
- **v1 全链验证**：compose→callout卡+per-approver签名链→点击经 Caddy→cards 验签(篡改403)→token转发→apply_decision→结果/进捗页，路由隔离(tasks根仍Plane)。降级形态=**零 Plane fork 即用**
- **内联 React runtime 节点（定型，弃 iframe，2026-05-19）**：
  - `packages/editor/src/core/extensions/barsoul-card/`（extension-config.ts atom block / block.tsx React NodeView 拉 `/c/<ref>?as=spec` 渲染 / extension.tsx ReactNodeViewRenderer / index.ts）—— **冻结薄缝**：节点永不随卡片类型变，新增卡片=改自有 cards 服务
  - `packages/editor/src/core/extensions/extensions.ts`：import + `BarsoulCardExtension` 入 `CoreEditorExtensions` 数组（**升级 re-apply 仅此 import+1 行+barsoul-card/ 目录**）
  - `apps/api/plane/utils/content_validator.py`：CUSTOM_TAGS 加 `barsoul-card` + ATTRIBUTES 加 `data-card`（**升级冲突点**）
  - cards `/c/<ref>?as=spec` 返结构化 JSON（actions 按 approver 展开签名 href，节点保持「笨」）
  - approval.py：compose 成功→评论嵌 `<barsoul-card data-card=ref>` + 永久安全 `<a>?as=view` 兜底；cards 不可达→callout HTML→内联签名卡（三级降级）
  - 验证：`?as=spec` 结构✓、`<barsoul-card>` 过 nh3 存活✓、前后端镜像重建部署✓、/__act 全链✓
  - **根因修复（2026-05-19）**：实测「只见文字」根因 = live 审批引擎是 **Temporal**（`APPROVAL_ENGINE=temporal`），create_approval 命中 Temporal 分支提前 return，卡注入只在 legacy(Bitable) 分支 → 不执行。修：
    - ai-bot `server.py` `/wf/act` 加 `compose_card` op（复用 approval.compose_card，与 legacy 单一源）
    - hermes-wf `internal/approval/activities.go` 加 `ComposeCard` 活动；`workflow.go` 审査のお願い 评论前调 ComposeCard→注入 `<barsoul-card>`+安全兜底链（失败空 ref→平文，编排不中断）
    - `~/stack/services/hermes-wf` 重建；`~/stack/workflow` 用**自身 .env**重部署（**注意：勿对 workflow 栈传 `--env-file ~/stack/.env`，会清空 `TEMPORAL_PG_PWD` 致 temporal 认证崩溃**——本次曾自伤、已恢复）
  - 边界验证全绿：`/wf/act compose_card`→embed_ref、nh3 存活、/__act 全链
- **R1+R2（2026-05-19，产品规划见 `~/stack/cards/PRODUCT_PLAN.md`）**：
  - R1 信息进卡+审批链/方式可视化：ai-bot `/approval/state`（X-Cards-Token，复用 fetch_chain → mode/status/progress/approvers[state]）；cards `resolveSpec` 出 `modebadge`(ALL全員/ANYいずれか1名)+`chain`(进捗+每人 pending/approved/rejected)+`detail` 透传；workflow.go 加 detail 区块；block.tsx 渲染状态点列/徽章/可折叠详情
  - R2 按权限渲染：block.tsx 用 **Plane 自身 `/api/users/me/`（session cookie，零代码耦合）** 取当前用户→`?me=`；cards 仅对「本人且待决」出签名按钮，me 空→authhint 只读，非审批人→只读无噪音。**签名口径永不被 me 放宽**（安全仍=HMAC 签名+audit，me 仅控渲染）
  - 全链服务端验证：已决→所有人只读；待决→本人见按钮/未登录见 authhint/他人只读；会签或签徽章；进捗
  - **升级冲突点**：`/approval/state`(ai-bot)、cards resolveSpec、block.tsx（仍冻结薄缝：视觉/逻辑全在 cards Go，调 UX 零 Plane 重建）
  - **待用户实操（同 P1）**：浏览器看 R1 版式 + 用审批人身份登录看 R2 按权限（需一条待决审批）
- **R4-轴B 5層手術（2026-05-23，治"3块病"）**：线上 70 张 approval 卡 LLM 只挑 `header/section/detail` 3 块。逐层动刀+逐层 bench 量化，**5 場景 baseline → final**：
  - **L0 模型** `compose model: default → gemma-4-26b`（"default" 网关被路到 :8002 qwen3.5-4b，4B 干 14 块 catalog 力不从心）→ `badge 0/5→4/5, compare 0/5→3/5`
  - **L1 catalog 富化** `/api/toolbox` 每块加 `example`(具体 JSON 见本) + `composition_rules`(全局选块优先级) + `pair_well_with`；emphasizes "detail は最後の手段" → structured ratio `0.58 → 0.69`，detail 跌至 0
  - **L2 prompt 重写** ❌NG パターン+✅良例 2 个 few-shot（与信枠+値引承認）+ 选块优先度独立段 → structured ratio `0.69 → 0.77`，callout 4→5
  - **L3 確定論 fact extractor** `_extract_facts(text)` regex 抽 amounts/URLs/bullets → user message 末尾「【抽出済…】← 必ず… で生かせ」→ **amount 3/5 → 5/5（满分），distinct 6.6 → 7.0**
  - **L4 critic+retry** `_critique()` regex 检查 block 数/structured/amount-when-¥/ref-when-URL；不合格 1 次重试（issues 追加到 prompt 施压）；retry 仍弱按 `_block_score` 取丰富者 → 回弹防护，distinct 7.0→7.2
  - **L5 telemetry** cards 0003 migration `card_block_usage` + `LogBlockUsage`(每卡按块拆行) + `GET /api/stats/blocks?since=N` (scenario × block_type usage_rate) → 长期 prompt/catalog 数据驱动迭代飞轮
  - **最终 vs baseline**：structured ratio **0.54 → 0.74**(+37% rel)、distinct types **6.8 → 7.4**、`badge 0→5/5`、`amount 2→5/5`、`compare 0→3/3 ceiling`、`detail 1+→0/5`、3块病在薄输入压测全消（5 个生产风格短输入平均 7 块/0.75 structured）
  - **bench 工件**：`/tmp/bench_L*.json` 7 文件，可复跑（`/Users/barsoul/llm-tools/weclaw-guard/.venv/bin/python` + bench script）
  - **改了**：cards `server.go`(toolbox enrichment + statsBlocks + LogBlockUsage 调用)、`store/store.go`(LogBlockUsage/BlockUsageStats + pgx import)、migration `0003_block_usage.sql`(手动 apply)、ai-bot `approval.py`(compose_content_blocks model/prompt/facts/critic/retry/draft_blocks helper)
  - **未做（薄弱处）**：`image` 0/5（bench scenarios 无 img URL；要 receipt OCR pipeline 喂 src，待轴 F 接通 PaddleOCR/MiniCPM-V）、telemetry dashboard（现仅 raw JSON endpoint，UI 看板待做）、critic 用 LLM（现 regex 已够强；若需更细致语义检查可后续接 qwen3.5-4b）

### B2. stack 配置（`~/stack/`）
- `caddy/Caddyfile` + `caddy/build/Dockerfile`(cloudflare-dns plugin) + `caddy/.env`(CF token) — `*.barsoul.jp` LE + Cloudflare DNS-01
- `authelia/config/configuration.yml` — barsoul.jp session domain + OIDC client `plane` + `search.email`
- `plane/plane.env` — `APP_DOMAIN/WEB_URL/CORS_ALLOWED_ORIGINS/AUTHELIA_HOST → tasks.barsoul.jp`，`AUTHELIA_*`，`PLANE_DEFAULT_WORKSPACE_SLUG/ROLE/AUTO_JOIN_PROJECTS`
- `n8n/compose.yml` `N8N_HOST` / `.env.example`

### B3. 自建服务（`~/llm-tools/` `~/.hermes/` `~/Library/LaunchAgents/`）
- **`~/llm-tools/llm-gateway/`（Go, host, 2026-05-19）— LLM 削峰填谷网关（单点·所有 LLM 必经）**
  - 问题：M4 Pro 单 GPU 同驻 3 模型（coder-30b@8000/gemma-26b@8001/qwen-4b@8002），多源同步直怼 → 突发拥塞 60s 超时/ConnectError → 审批丑回退
  - 方案：`com.local.llm.gateway.plist` 127.0.0.1:**8200**。OpenAI 兼容，按请求体 `model` 多上游路由（`ROUTES` env，默认 8000/8001/8002）；**单一全局 GPU 队列**(MAXQ=48) + 集中超时(UP_TIMEOUT_S=180)+重试(RETRY=2) + **队满立即 503 `llm_busy`**（快速降级，非慢挂）；`X-LLM-Priority: interactive(默认)|background`（审批组合=background 让路用户面）
  - **接入（升级/迁移必复原）**：① ai-bot `server.py` `LLM_URL` 改 env 默认 :8200 + `~/.hermes/.secrets.env` `LLM_URL=…:8200`（approval.py `_LLM_URL` 同源；compose_content_blocks 带 `X-LLM-Priority:background`、timeout 200）② weclaw-guard `com.local.llm.guard.plist` `FAST_URL/CODER_URL/MAIN_URL` → :8200（网关按 model 字段路由回 8002/8000）
  - **黄金律**：新增任何调 LLM 的服务，URL 必指 :8200，勿直怼 8000/8001/8002。网关挂=全 LLM 断（KeepAlive 已配；排障先看 `~/.local/var/log/rapid-mlx/llm-gateway.log` 与 `/healthz`）
  - **硬化（2026-05-20）**：未路由/空 `model` → 立即 **400 `llm_unknown_model`**（回 `known` 别名表），不再静默兜底到固定端口（旧 code 默认硬编已死的 :8001 → 隐性错路由/慢挂，已删）。`UP_DEFAULT` 现**仅** `/v1/models` passthru 用（未设则取 routes 任一）；chat 路径完全不看 `UP_DEFAULT`。调用方必须显式带已知 `model` 别名。备份 `~/.local/bin/llm-gateway.bak-*`
  - **现网拓扑实测（2026-05-20，ground truth 优先于旧假设）**：:8001=活 gemma-4-26b（单模型，忽略 id）｜:8002=qwen3.5-4b｜:8003=多模型 MLX(mlx_vlm.server，含 gemma/coder/qwen 真实 HF id)｜**:8000=DOWN**
  - **P0 已修（2026-05-20）事故**：weclaw-guard `MAIN_MODEL=CODER_MODEL=qwen3-coder-30b` 全经 :8200 → 主脑走 coder 别名；但旧 `ROUTES` `qwen3-coder-30b→:8001`（=gemma）→ **主脑每次被 gemma 静默顶替（在跑的质量事故，能出答案故无人察觉）**。修：plist `ROUTES` `qwen3-coder-30b=http://127.0.0.1:8003` + `REWRITE` 加 `qwen3-coder-30b=mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit`。已实测 coder e2e 200（:8003 真 coder）、default/gemma e2e 200（:8001 2.97s）
  - **P1 路由对账（2026-05-20，防复发）**：`reconcileLoop` 周期(env `RECONCILE_S`=300)探每个 ROUTES 上游 `/v1/models`，按**模型族 token 交集**判 served 是否同族于 REWRITE 后期望 id（解决「单模 server 报短名 vs 期望长 HF id」精确比对必假阴；且能区分 gemma别名→gemma单模OK vs coder别名→gemma单模报警）。结果挂 `/healthz`：`route_warnings[]` + `ok=false`，错路由同时 log `ROUTE MISMATCH`。硬化只挡未知别名，此对账补「已知别名指错端口、上游静默返别的模型」的盲区
  - **⚠️ launchctl 坑（实测踩中）**：`launchctl kickstart -k` 只重启进程、**不重载 plist**（用内存中旧 env）。改 plist `EnvironmentVariables`(ROUTES/REWRITE 等) 后必须 `launchctl bootout gui/$(id -u)/com.local.llm.gateway && launchctl bootstrap gui/$(id -u) <plist>`。只换二进制(ProgramArguments 路径不变)用 kickstart 即可
  - **P2 待决策（不可逆·需点头）**：单 M4 Pro GPU 同驻 :8001(gemma)+:8002(qwen4b)+:8003(多模型含 gemma+coder) = 同族双份占统一内存+互抢；首次冷载 30B coder 占满队列 >60s（属单全局队列削峰设计内，UP_TIMEOUT_S=180+retry 兜底，调用方 client 超时需≥180s）。正解：收敛重模型到 :8003 单一上游 + 留 :8002 作常温小快专路 + 下线冗余 :8001
- `~/llm-tools/ai-bot/server.py` — 愛ちゃん Plane ReAct agent + issue 状态变更 Lark 卡片推送（webhook :8098）
- **即点即译（X 式 lazy translate, hechun 自作）— `apps/api/plane/app/views/issue/comment.py`**
  - 入口 `CommentTranslateOnDemandEndpoint`（cookie auth, 项目成员可触发）。译文 upsert `CommentTranslation`，带 cache + 质量门（src≥3段/tgt<50% 或 src≥200字/tgt<40% → soft-delete 重译）
  - **内容哈希缓存（2026-05-31, hechun 发现"每次打开都重译"）**：前端 `display.tsx` 永远走 **override 路径**（POST `text=maskedText` tokenized ⟦N⟧），旧实现该路径**完全不读写缓存表** → 每次开 issue 点翻译都真调 LLM。修：`CommentTranslation` 加 `source_hash`(masked text sha256, migration `0124`)，override 路径按 `(comment,target_lang)` 查 + hash 匹配则 DB hit(~5ms 零 LLM)，否则译完 upsert。**self-invalidating**：评论编辑→comment_html变→masked变→hash变→自然 miss 重译（无需 edit 事件 hook）。前端组件内 `trHtml` state memo 是互补的"同次挂载不重取"，DB 缓存解决"跨次打开"。view 级 RequestFactory 实测：call#1 cached=False/LLM=1、call#2 同内容 cached=True/**LLM 仍=1**、call#3 编辑后 cached=False/LLM=2
  - **翻译模型 = Hy-MT2-7B 一本（2026-05-31 简化）**：`_TRANSLATE_FALLBACK_CHAIN=["hy-mt2"]`。曾有 cloud Claude(CLI subprocess) 主路 + qwen3.5-4b 退避，但 ① **Claude CLI `-p` 在 launchd 非 TTY 下 OAuth/subscribe 静默 hang 30s**（`cloud_translate` 已标 DEPRECATED 保留作未来 Anthropic API 直叩脚手架，零调用）② qwen3.5-4b 通用 4B 翻译质量差（主语颠倒/用语乱）→ 两者皆下线
  - **模型升级 1.8B→7B（2026-05-31）**：`~/models/Hy-MT2-7B-mlx-q4`(4.0GB, mlx-community/Hy-MT2-7B-4bit)，`com.local.llm.hy-mt2.plist` serve :8004，gateway alias `hy-mt2`(served-model-name 不变→调用方零改)。延迟 0.5→0.9s。**专家诊断 26 case：7B 裸 prompt 21/26 PASS**（婉拒否定/和製英語/多义动词/複文/敬語 全过，1.8B 必崩项）；旧 1.8B 保留可秒回滚（plist 一行）
  - **prompt 三层组合（仅 hy-mt2 分支, `_try_one_model`）**：①`voice_rule` 视点/态 4 条正例规则（**仅 tgt==zh**：省略主语施動者/とのこと转述/被动承受方/定语从句完整）②`ctx_prefix` issue 件名自然文 prefix「以下是「{件名}」工单的对话片段。」③ 基础指令。endpoint 从 `Issue.objects...only('name')` 取件名注入 context
  - **诊断剩余短板**：A3「とのこと转述指示」施動者判定约 50% 抖动（7B 能力边界，纯 prompt 难 100% 治死，已接受）。彻底解需 Hy-MT2-30B-A3B（MoE，mlx-community 暂未转）
  - **翻译 prompt 三铁律（小模型踩坑沉淀）**：①**只用正例，反例会被照抄**（1.8B 实测把「❌我是日本人」抄进输出）②**语法规则按方向施加**（解析日语的规则只在 ja→zh 加，中译日不挂）③**先升模型再调 prompt**（1.8B 4 轮 prompt 治不动的 c1，7B 一发+一条规则解决）④ hy-mt2 会把 marker(【】/---/&lt;tag&gt;) 漏进译文 → context 用**自然文句**而非 marker 包裹
- `~/llm-tools/lark-bridge/server.py` — Lark↔Hermes 双向（WS 长连接→weclaw-guard，复用大脑；card action 回调；v1 message handler；OCR→建案）
- `~/llm-tools/weclaw-guard/server.py` — 员工 assignee 过滤 + PLANE_NOUN 扩 + 路由
- `~/.hermes/bin/` — `health-monitor`（10min, Lark 告警）`backup-to-gdrive`（每日 02:00, openssl+GFS→My Drive）`lark-notify` `lark-push` `retrospect`(→Lark)
- `~/Library/LaunchAgents/com.local.*.plist` — healthmon / backup / ai-bot / lark-bridge / llm.guard(FAST_URL/CODER_URL→:8200) / **llm.hy-mt2**(rapid-mlx serve `~/models/Hy-MT2-7B-mlx-q4` :8004, 即点即译专用翻译模型)
- `~/.hermes/skills/productivity/lark-send` — Lark 通知策略 skill
- `~/.hermes/employee_uins.yml` — WeChat UIN + plane_email + lark_email + lark_open_id 映射

### B4. 凭证（在 `~/.hermes/.secrets.env` / `~/.lark-cli/` / keychain — **泄露过需 rotate**）
- Cloudflare DNS token、Resend、Lark App ID/Secret + OAuth token、Plane API key、AI_BOT token/webhook secret、backup 加密 key

---

## 已知升级风险点

1. **运维稳定性补丁（A2 运维段）最关键** — 漏 re-apply 会导致 Celery worker 全 hang（遥测/邮件/日志三处），症状是 Plane 通知/活动全部不处理
2. `help-section/root.tsx` 删了上游菜单项 — 上游若重构此文件需手动比对
3. `entry.client.tsx`/`root.tsx` hydration 修复依赖 RR7 SPA 行为 — 上游若改渲染机制需重新验证 #418
4. UI CSS 选择器 ①② 依赖 Tailwind class（脆），③ `href` 选择器稳；上游 class 变更 ①② 会静默失效（不报错，元素重现）
