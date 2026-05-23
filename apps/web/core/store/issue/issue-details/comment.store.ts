/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { pull, concat, update, uniq, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// Plane Imports
import type { TIssueComment, TIssueCommentMap, TIssueCommentIdMap, TIssueServiceType } from "@plane/types";
// services
import { IssueCommentService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export type TCommentLoader = "fetch" | "create" | "update" | "delete" | "mutate" | undefined;

export interface IIssueCommentStoreActions {
  fetchComments: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType?: TCommentLoader
  ) => Promise<TIssueComment[]>;
  fetchCommentsReplace: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssueComment[]>;
  createComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  updateComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  removeComment: (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => Promise<any>;
}

export interface IIssueCommentStore extends IIssueCommentStoreActions {
  // observables
  loader: TCommentLoader;
  comments: TIssueCommentIdMap;
  commentMap: TIssueCommentMap;
  // helper methods
  getCommentsByIssueId: (issueId: string) => string[] | undefined;
  getCommentById: (activityId: string) => TIssueComment | undefined;
}

export class IssueCommentStore implements IIssueCommentStore {
  // observables
  loader: TCommentLoader = "fetch";
  comments: TIssueCommentIdMap = {};
  commentMap: TIssueCommentMap = {};
  serviceType;
  // root store
  rootIssueDetail: IIssueDetail;
  // services
  issueCommentService;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      comments: observable,
      commentMap: observable,
      // actions
      fetchComments: action,
      fetchCommentsReplace: action,
      createComment: action,
      updateComment: action,
      removeComment: action,
    });
    // root store
    this.serviceType = serviceType;
    this.rootIssueDetail = rootStore;
    // services
    this.issueCommentService = new IssueCommentService(serviceType);
  }

  // helper methods
  getCommentsByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.comments[issueId] ?? undefined;
  };

  getCommentById = (commentId: string) => {
    if (!commentId) return undefined;
    return this.commentMap[commentId] ?? undefined;
  };

  fetchComments = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType: TCommentLoader = "fetch"
  ) => {
    this.loader = loaderType;

    let props = {};
    const _commentIds = this.getCommentsByIssueId(issueId);
    if (_commentIds && _commentIds.length > 0) {
      const _comment = this.getCommentById(_commentIds[_commentIds.length - 1]);
      if (_comment) props = { created_at__gt: _comment.created_at };
    }

    const comments = await this.issueCommentService.getIssueComments(workspaceSlug, projectId, issueId, props);

    const commentIds = comments.map((comment) => comment.id);
    runInAction(() => {
      update(this.comments, issueId, (_commentIds) => {
        if (!_commentIds) return commentIds;
        return uniq(concat(_commentIds, commentIds));
      });
      comments.forEach((comment) => {
        this.rootIssueDetail.commentReaction.applyCommentReactions(comment.id, comment?.comment_reactions || []);
        set(this.commentMap, comment.id, comment);
      });
      this.loader = undefined;
    });

    return comments;
  };

  // BARSOUL realtime: 全件再取得して issue のコメント ID リストを
  //   【置換】(append しない)。`fetchComments` は created_at__gt の
  //   増分 append 専用 → 他窓口での編集/削除が永久に反映されない
  //   (この class の根因)。本メソッドは全件 GET → comments[issueId]
  //   を丸ごと差し替え + commentMap upsert。レンダは comment id を
  //   key にしているので React が差分照合: 変更行のみ再描画・削除行
  //   のみ unmount・新規のみ mount = フラッシュ無し。loader は
  //   触らない(静かな背景同期。スケルトンを出さない)。
  fetchCommentsReplace = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const comments = await this.issueCommentService.getIssueComments(workspaceSlug, projectId, issueId, {});
    const commentIds = comments.map((comment) => comment.id);
    runInAction(() => {
      set(this.comments, issueId, commentIds); // 増分 concat ではなく置換
      comments.forEach((comment) => {
        this.rootIssueDetail.commentReaction.applyCommentReactions(comment.id, comment?.comment_reactions || []);
        set(this.commentMap, comment.id, comment);
      });
    });
    return comments;
  };

  createComment = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssueComment>) => {
    const response = await this.issueCommentService.createIssueComment(workspaceSlug, projectId, issueId, data);

    runInAction(() => {
      update(this.comments, issueId, (_commentIds) => {
        if (!_commentIds) return [response.id];
        return uniq(concat(_commentIds, [response.id]));
      });
      set(this.commentMap, response.id, response);
    });

    return response;
  };

  updateComment = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => {
    try {
      runInAction(() => {
        Object.keys(data).forEach((key) => {
          set(this.commentMap, [commentId, key], data[key as keyof TIssueComment]);
        });
      });

      const response = await this.issueCommentService.patchIssueComment(
        workspaceSlug,
        projectId,
        issueId,
        commentId,
        data
      );

      runInAction(() => {
        set(this.commentMap, [commentId, "updated_at"], response.updated_at);
        set(this.commentMap, [commentId, "edited_at"], response.edited_at);
      });

      return response;
    } catch (error) {
      this.rootIssueDetail.activity.fetchActivities(workspaceSlug, projectId, issueId);
      throw error;
    }
  };

  removeComment = async (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => {
    const response = await this.issueCommentService.deleteIssueComment(workspaceSlug, projectId, issueId, commentId);

    runInAction(() => {
      pull(this.comments[issueId], commentId);
      delete this.commentMap[commentId];
    });

    return response;
  };
}
