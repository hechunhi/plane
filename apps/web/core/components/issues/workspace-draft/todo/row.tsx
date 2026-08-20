/**
 * BARSOUL 2026-08 — ToDo の 1 行。親も子も同じ部品(`depth` が違うだけ)。
 *
 * この画面の速さは「行を離れない」ことで出す。題名はその場で直せるし、
 * Enter で次の行が開き、Tab で子になり、⌘Enter で済になる。重いモーダルは
 * 「プロジェクトへ移す」「詳細を書く」まで出てこない。
 *
 * 子は 1 段だけ。深い入れ子は、畳んだ瞬間に中身を忘れる。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { omit } from "lodash-es";
import { observer } from "mobx-react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  GripVertical,
  ListPlus,
  NotebookPen,
  SquareStackIcon,
} from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CopyIcon, EditIcon, TrashIcon } from "@plane/propel/icons";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type { TWorkspaceDraftIssue } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import type { TContextMenuItem } from "@plane/ui";
import { cn, renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
// local imports
import { CreateUpdateIssueModal } from "../../issue-modal/modal";
import { WorkspaceDraftIssueDeleteIssueModal } from "../delete-modal";
import { DraftIssueProperties } from "../draft-issue-properties";
import { WorkspaceDraftIssueQuickActions } from "../quick-action";
import { TodoTextarea } from "./auto-textarea";
import { TodoComposer } from "./composer";
import { useTodoList } from "./context";

type Props = {
  workspaceSlug: string;
  issueId: string;
  /** 0 = 親、1 = 子タスク。 */
  depth: 0 | 1;
  /** 完了した ToDo の引き出しの中。並べ替えも子タスクも出さない。 */
  isInCompletedDrawer?: boolean;
};

type TTodoDragData = { type: "TODO_ROW"; id: string; parentId: string | null };

export const TodoRow = observer(function TodoRow(props: Props) {
  const { workspaceSlug, issueId, depth, isInCompletedDrawer = false } = props;
  // hooks
  const { t } = useTranslation();
  const {
    getIssueById,
    getSubIssueIds,
    getSubIssueProgress,
    issueIds,
    updateIssue,
    deleteIssue,
    toggleDone,
    reorderIssue,
  } = useWorkspaceDraftIssues();
  const { getProjectIdentifierById } = useProject();
  const { registerRow, focusRow, neighbourOf, isExpanded, toggleExpanded, setExpanded, composer, openComposer } =
    useTodoList();
  // refs
  const rowRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const memoRef = useRef<HTMLTextAreaElement | null>(null);
  // derived
  const issue = getIssueById(issueId);
  const parentId = issue?.todo_parent_id ?? null;
  const subIssueIds = depth === 0 && !isInCompletedDrawer ? getSubIssueIds(issueId) : [];
  const progress = depth === 0 ? getSubIssueProgress(issueId) : undefined;
  // states
  const [title, setTitle] = useState(issue?.name ?? "");
  const [memo, setMemo] = useState(issue?.memo ?? "");
  const [isMemoOpen, setIsMemoOpen] = useState(!!issue?.memo);
  const [closestEdge, setClosestEdge] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueToEdit, setIssueToEdit] = useState<TWorkspaceDraftIssue | undefined>(undefined);
  const [isMovingToProject, setIsMovingToProject] = useState(false);

  // 他所(モーダル、別端末、取り消し)で名前が変わったら追随する。
  // 入力中(フォーカス中)は上書きしない —— 打っている字が消える。
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitle(issue?.name ?? "");
  }, [issue?.name]);
  useEffect(() => {
    if (document.activeElement !== memoRef.current) setMemo(issue?.memo ?? "");
  }, [issue?.memo]);

  useEffect(() => {
    registerRow(issueId, titleRef.current);
    return () => registerRow(issueId, null);
  }, [issueId, registerRow]);

  // --- 保存 ---------------------------------------------------------------
  const commitTitle = useCallback(() => {
    // 題名は 1 行。複数行を貼った時はここで畳む(まとめて入れたい人は上の入力欄へ)。
    const next = title.replace(/\s*\n+\s*/g, " ").trim();
    // 空にした = 消したい、ではない(誤爆が怖い)。元に戻すだけ。
    if (!next) {
      setTitle(issue?.name ?? "");
      return;
    }
    if (next !== title) setTitle(next);
    if (next === issue?.name) return;
    void updateIssue(workspaceSlug, issueId, { name: next });
  }, [issue?.name, issueId, title, updateIssue, workspaceSlug]);

  const commitMemo = useCallback(() => {
    if (memo === (issue?.memo ?? "")) return;
    void updateIssue(workspaceSlug, issueId, { memo } as Partial<TWorkspaceDraftIssue>);
  }, [issue?.memo, issueId, memo, updateIssue, workspaceSlug]);

  // メモは黙って消えると痛いので、打つ手が止まった所で勝手に保存する。
  useEffect(() => {
    if (memo === (issue?.memo ?? "")) return;
    const timer = setTimeout(() => commitMemo(), 800);
    return () => clearTimeout(timer);
  }, [memo, issue?.memo, commitMemo]);

  // --- 段替え -------------------------------------------------------------
  /** 直前の兄弟の子にする。子は 1 段だけなので、子を持つ行は下げない。 */
  const indent = useCallback(() => {
    if (depth !== 0 || subIssueIds.length > 0) return;
    const index = issueIds.indexOf(issueId);
    const previousId = index > 0 ? issueIds[index - 1] : undefined;
    if (!previousId) return;
    const existingChildren = getSubIssueIds(previousId);
    setExpanded(previousId, true);
    void reorderIssue(workspaceSlug, issueId, previousId, existingChildren[existingChildren.length - 1], undefined);
  }, [depth, getSubIssueIds, issueId, issueIds, reorderIssue, setExpanded, subIssueIds.length, workspaceSlug]);

  /** 親の直後に出る。 */
  const outdent = useCallback(() => {
    if (depth !== 1 || !parentId) return;
    const index = issueIds.indexOf(parentId);
    void reorderIssue(workspaceSlug, issueId, null, parentId, index >= 0 ? issueIds[index + 1] : undefined);
  }, [depth, issueId, issueIds, parentId, reorderIssue, workspaceSlug]);

  // --- 並べ替え(掴んで動かす) --------------------------------------------
  const isDone = !!issue?.done_at;
  const canReorder = !isInCompletedDrawer && !isDone;

  useEffect(() => {
    const element = rowRef.current;
    const handle = handleRef.current;
    if (!element || !handle || !canReorder) return;
    const data: TTodoDragData = { type: "TODO_ROW", id: issueId, parentId };
    return combine(
      draggable({
        element,
        dragHandle: handle,
        getInitialData: () => data as unknown as Record<string, unknown>,
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.type === "TODO_ROW" && source.data.id !== issueId,
        getData: ({ input, element: target }) =>
          attachClosestEdge(data as unknown as Record<string, unknown>, {
            input,
            element: target,
            allowedEdges: ["top", "bottom"],
          }),
        onDrag: (args) => setClosestEdge(extractClosestEdge(args.self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: (args) => {
          setClosestEdge(null);
          const source = args.source.data as unknown as TTodoDragData;
          const edge = extractClosestEdge(args.self.data);
          // 子を持つ行は子にできない(段は 1 つだけ)。掴んだ物をそのまま返す。
          const sourceHasChildren = getSubIssueIds(source.id).length > 0;
          if (sourceHasChildren && parentId) {
            setToast({
              type: TOAST_TYPE.INFO,
              title: t("workspace_draft_issues.todo.nesting_limited"),
            });
            return;
          }
          const siblingIds = (parentId ? getSubIssueIds(parentId) : issueIds).filter((id) => id !== source.id);
          const targetIndex = siblingIds.indexOf(issueId);
          if (targetIndex < 0) return;
          const beforeId = edge === "top" ? siblingIds[targetIndex - 1] : siblingIds[targetIndex];
          const afterId = edge === "top" ? siblingIds[targetIndex] : siblingIds[targetIndex + 1];
          void reorderIssue(workspaceSlug, source.id, parentId, beforeId, afterId);
        },
      })
    );
  }, [canReorder, getSubIssueIds, issueId, issueIds, parentId, reorderIssue, t, workspaceSlug]);

  if (!issue) return null;

  const projectIdentifier = (issue.project_id && getProjectIdentifierById(issue.project_id)) || undefined;
  const expanded = isExpanded(issueId);

  // --- キーボード ---------------------------------------------------------
  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const element = event.currentTarget;
    // 変換中の Enter は確定であって改行ではない。ここを見ないと日本語が打てない。
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commitTitle();
      void toggleDone(workspaceSlug, issueId);
      return;
    }
    if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      setIsMemoOpen(true);
      window.setTimeout(() => memoRef.current?.focus(), 0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitTitle();
      openComposer({ parentId, afterId: issueId });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      commitTitle();
      if (event.shiftKey) outdent();
      else indent();
      // 段が変わっても入力は続けられる方が良い。
      window.setTimeout(() => focusRow(issueId), 0);
      return;
    }
    if (event.key === "ArrowUp" && element.selectionStart === 0) {
      const previousId = neighbourOf(issueId, -1);
      if (previousId) {
        event.preventDefault();
        commitTitle();
        focusRow(previousId);
      }
      return;
    }
    if (event.key === "ArrowDown" && element.selectionEnd === element.value.length) {
      const nextId = neighbourOf(issueId, 1);
      if (nextId) {
        event.preventDefault();
        commitTitle();
        focusRow(nextId);
      }
      return;
    }
    if (event.key === "Backspace" && element.value === "" && (issue.name ?? "").length === 0) {
      // ここに来るのは元から名無しの行だけ。名前を消しただけの行は消さない。
      event.preventDefault();
      const previousId = neighbourOf(issueId, -1);
      void deleteIssue(workspaceSlug, issueId).then(() => previousId && focusRow(previousId));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setTitle(issue.name ?? "");
      element.blur();
    }
  };

  // --- メニュー -----------------------------------------------------------
  const duplicatePayload = omit({ ...issue, name: `${issue.name} (copy)`, is_draft: true }, ["id"]);

  // 触る端末には掴む手が無い(掴みは md 以上でしか出せない)。上下 1 つずつでも
  // 動かせないと、スマホで作った並びは永久に直せなくなる。だからメニューにも置く。
  const siblingIds = parentId ? getSubIssueIds(parentId) : issueIds;
  const siblingIndex = siblingIds.indexOf(issueId);
  const moveBy = (direction: -1 | 1) => {
    if (siblingIndex < 0) return;
    const target = siblingIndex + direction;
    if (target < 0 || target >= siblingIds.length) return;
    const beforeId = direction === -1 ? siblingIds[siblingIndex - 2] : siblingIds[siblingIndex + 1];
    const afterId = direction === -1 ? siblingIds[siblingIndex - 1] : siblingIds[siblingIndex + 2];
    void reorderIssue(workspaceSlug, issueId, parentId, beforeId, afterId);
  };

  const addSubTask = () => {
    setExpanded(issueId, true);
    openComposer({ parentId: issueId, afterId: subIssueIds[subIssueIds.length - 1] });
  };

  const MENU_ITEMS: TContextMenuItem[] = [
    {
      key: "add-sub-task",
      title: "workspace_draft_issues.todo.add_sub_task",
      icon: ListPlus,
      shouldRender: depth === 0 && !isInCompletedDrawer,
      action: addSubTask,
    },
    {
      key: "move-up",
      title: "workspace_draft_issues.todo.move_up",
      icon: ArrowUp,
      shouldRender: !isInCompletedDrawer,
      disabled: siblingIndex <= 0,
      action: () => moveBy(-1),
    },
    {
      key: "move-down",
      title: "workspace_draft_issues.todo.move_down",
      icon: ArrowDown,
      shouldRender: !isInCompletedDrawer,
      disabled: siblingIndex < 0 || siblingIndex >= siblingIds.length - 1,
      action: () => moveBy(1),
    },
    {
      key: "edit",
      title: "edit",
      icon: EditIcon,
      action: () => {
        setIssueToEdit(issue);
        setIsIssueModalOpen(true);
      },
    },
    {
      key: "make-a-copy",
      title: "make_a_copy",
      icon: CopyIcon,
      action: () => setIsIssueModalOpen(true),
    },
    {
      key: "move-to-issues",
      title: "move_to_project",
      icon: SquareStackIcon,
      action: () => {
        setIsMovingToProject(true);
        setIssueToEdit(issue);
        setIsIssueModalOpen(true);
      },
    },
    {
      key: "delete",
      title: "delete",
      icon: TrashIcon,
      action: () => setIsDeleteModalOpen(true),
    },
  ];

  return (
    <>
      <WorkspaceDraftIssueDeleteIssueModal
        data={issue}
        isOpen={isDeleteModalOpen}
        handleClose={() => setIsDeleteModalOpen(false)}
        onSubmit={async () => deleteIssue(workspaceSlug, issueId)}
      />
      <CreateUpdateIssueModal
        isOpen={isIssueModalOpen}
        onClose={() => {
          setIsIssueModalOpen(false);
          setIssueToEdit(undefined);
          setIsMovingToProject(false);
        }}
        data={issueToEdit ?? duplicatePayload}
        onSubmit={async (data) => {
          if (issueToEdit) await updateIssue(workspaceSlug, issueId, data);
        }}
        storeType={EIssuesStoreType.WORKSPACE_DRAFT}
        fetchIssueDetails={false}
        moveToIssue={isMovingToProject}
        isDraft
      />

      <div
        ref={rowRef}
        id={`todo-${issueId}`}
        className={cn("relative border-b border-subtle-1 bg-surface-1 transition-opacity", {
          "opacity-40": isDragging,
        })}
      >
        {/* 落とす位置の線。行の上か下かをはっきり見せる。 */}
        {closestEdge && (
          <div
            className={cn("pointer-events-none absolute inset-x-0 z-[1] h-0.5 bg-accent-primary", {
              "-top-px": closestEdge === "top",
              "-bottom-px": closestEdge === "bottom",
            })}
          />
        )}

        <div
          className={cn(
            "group/todo flex items-start gap-1.5 py-2 pr-2 md:pr-4",
            depth === 1 ? "pl-9 md:pl-12" : "pl-1.5 md:pl-3"
          )}
        >
          {/* 掴む所。常に置く(触っている端末では hover が無い)。 */}
          <button
            ref={handleRef}
            type="button"
            aria-label={t("workspace_draft_issues.todo.reorder")}
            tabIndex={-1}
            className={cn(
              "mt-1 hidden size-5 flex-shrink-0 cursor-grab place-items-center text-placeholder transition-opacity active:cursor-grabbing md:grid md:opacity-0 md:group-hover/todo:opacity-100",
              // 動かせない行(済んだ行)でも桁は残す。ここを md:hidden にすると
              // 掴む手の幅だけ行が左に寄って、子の段差が消えて見える。
              { "md:pointer-events-none md:group-hover/todo:opacity-0": !canReorder }
            )}
          >
            <GripVertical className="size-3.5" />
          </button>

          {/* 子タスクの畳み。子が居る親にだけ出す。 */}
          {depth === 0 && subIssueIds.length > 0 ? (
            <button
              type="button"
              onClick={() => toggleExpanded(issueId)}
              aria-expanded={expanded}
              aria-label={t(expanded ? "workspace_draft_issues.todo.collapse" : "workspace_draft_issues.todo.expand")}
              className="mt-0.5 grid size-5 flex-shrink-0 place-items-center rounded text-tertiary hover:bg-layer-1 hover:text-secondary"
            >
              <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
            </button>
          ) : (
            <span className="mt-0.5 size-5 flex-shrink-0" aria-hidden />
          )}

          {/* 済にする丸。ここが唯一の入口。 */}
          <button
            type="button"
            aria-pressed={isDone}
            aria-label={t("workspace_draft_issues.todo.toggle_done")}
            className={cn(
              "mt-0.5 grid size-5 flex-shrink-0 place-items-center rounded-full border transition-colors",
              isDone
                ? "border-accent-primary bg-accent-primary text-on-color"
                : "border-strong text-transparent hover:border-accent-primary"
            )}
            onClick={() => toggleDone(workspaceSlug, issueId)}
          >
            <Check className="size-3" strokeWidth={3} />
          </button>

          <div className="min-w-0 flex-1">
            <TodoTextarea
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              onBlur={commitTitle}
              aria-label={issue.name}
              className={cn("py-0.5 text-13 leading-5 text-primary", isDone && "text-tertiary line-through")}
            />

            {/* メモ。開いている間だけ。閉じても中身は消えない。 */}
            {isMemoOpen && (
              <TodoTextarea
                ref={memoRef}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                onBlur={commitMemo}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commitMemo();
                    focusRow(issueId);
                  }
                }}
                placeholder={t("workspace_draft_issues.todo.memo_placeholder")}
                aria-label={t("workspace_draft_issues.todo.memo")}
                className="mt-0.5 border-l-2 border-strong pl-2 text-12 leading-5 text-secondary placeholder:text-placeholder"
              />
            )}

            {/* 2 行目は **中身がある時だけ**。行き先未定の走り書きが大半なので、
                「未分類」を全行に出すと、一覧は灰色の札で埋まって読めなくなる。
                プロジェクトが決まった行にだけ、その先の情報を出す。 */}
            {depth === 0 && issue.project_id && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                {projectIdentifier && (
                  <span className="whitespace-nowrap rounded-sm bg-layer-1 px-1.5 py-0.5 text-11 text-secondary">
                    {projectIdentifier}
                  </span>
                )}
                <DraftIssueProperties
                  className="relative flex flex-wrap items-center gap-2 whitespace-nowrap"
                  issue={issue}
                  updateIssue={async (_projectId, id, data) => {
                    await updateIssue(workspaceSlug, id, data);
                  }}
                />
              </div>
            )}
          </div>

          {/* 右の手。触っている端末では常に見える(hover が無いので)。 */}
          <div className="flex flex-shrink-0 items-center gap-0.5 pt-0.5">
            {/* 子の進み。畳んだままでも「あと 2 つ」が読めることに意味がある。 */}
            {progress && (
              <span
                className={cn(
                  "px-1 text-11 tabular-nums",
                  progress.done === progress.total ? "text-accent-primary" : "text-tertiary"
                )}
              >
                {progress.done}/{progress.total}
              </span>
            )}

            {/* 期日。行き先未定の ToDo にこそ期日が要る。プロジェクト付きの行は
                2 行目の property 一覧が期日を持っているので、ここには出さない。 */}
            {!issue.project_id && (
              // 狭い画面では、空の期日ボタンまで並べると題名の幅が無くなる。
              // 入っている期日は情報なので残し、空のものは menu の「編集」に譲る。
              <div
                className={cn("h-5", !issue.target_date && "hidden md:block")}
                onClick={(e) => e.stopPropagation()}
              >
                <DateDropdown
                  value={issue.target_date ?? null}
                  onChange={(date) =>
                    updateIssue(workspaceSlug, issueId, {
                      target_date: date ? (renderFormattedPayloadDate(date) ?? undefined) : undefined,
                    })
                  }
                  placeholder={t("workspace_draft_issues.todo.due_date")}
                  buttonVariant={issue.target_date ? "border-with-text" : "border-without-text"}
                  buttonClassName={issue.target_date ? "" : "md:opacity-0 md:group-hover/todo:opacity-100"}
                  optionsClassName="z-10"
                  showTooltip
                />
              </div>
            )}

            {depth === 0 && !isInCompletedDrawer && (
              <button
                type="button"
                aria-label={t("workspace_draft_issues.todo.add_sub_task")}
                title={t("workspace_draft_issues.todo.add_sub_task")}
                className="hidden size-7 place-items-center rounded text-tertiary transition-colors hover:bg-layer-1 hover:text-secondary md:grid md:opacity-0 md:group-hover/todo:opacity-100"
                onClick={addSubTask}
              >
                <ListPlus className="size-4" />
              </button>
            )}
            <button
              type="button"
              aria-label={t("workspace_draft_issues.todo.memo")}
              title={t("workspace_draft_issues.todo.memo")}
              className={cn(
                "grid size-7 place-items-center rounded transition-colors hover:bg-layer-1 hover:text-secondary",
                issue.memo
                  ? "text-accent-primary"
                  : "text-tertiary md:opacity-0 md:group-hover/todo:opacity-100"
              )}
              onClick={() => {
                const next = !isMemoOpen;
                setIsMemoOpen(next);
                if (next) window.setTimeout(() => memoRef.current?.focus(), 0);
              }}
            >
              <NotebookPen className="size-4" />
            </button>
            <div className="rounded-sm">
              <WorkspaceDraftIssueQuickActions parentRef={rowRef} MENU_ITEMS={MENU_ITEMS} />
            </div>
          </div>
        </div>
      </div>

      {/* 子タスク */}
      {depth === 0 && expanded && subIssueIds.map((childId) => (
        <TodoRow key={childId} workspaceSlug={workspaceSlug} issueId={childId} depth={1} />
      ))}

      {/* 子を足す欄 */}
      {depth === 0 && expanded && composer?.parentId === issueId && (
        <TodoComposer workspaceSlug={workspaceSlug} parentId={issueId} afterId={composer.afterId} />
      )}

      {/* 同じ段の次の行を足す欄 */}
      {composer?.parentId === parentId && composer?.afterId === issueId && (
        <TodoComposer workspaceSlug={workspaceSlug} parentId={parentId} afterId={issueId} />
      )}
    </>
  );
});
