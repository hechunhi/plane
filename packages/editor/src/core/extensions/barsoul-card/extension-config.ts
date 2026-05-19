/**
 * BARSOUL: 评论内交互卡片「冻结薄缝」节点。
 * 设计纪律：本节点永不随卡片类型变 —— 只持 data-card(=<id>.<sig>)，
 * NodeView 拉 cards 微服务 ?as=spec 渲染。新增卡片类型/区块 = 改自有
 * cards 服务，本文件零改动。升级 Plane 时只需 re-apply 这一稳定小 diff。
 */
import { Node, mergeAttributes } from "@tiptap/core";

export const BARSOUL_CARD_NAME = "barsoulCard";

export const BarsoulCardExtensionConfig = Node.create({
  name: BARSOUL_CARD_NAME,
  group: "block",
  atom: true,
  // BARSOUL: ノード選択(青い選択背景)を無効化。カードは UI 部品であって
  // 編集対象テキストではない → 誤選択の見栄え悪化を根治。
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      "data-card": { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "barsoul-card" }];
  },

  renderHTML({ HTMLAttributes }) {
    // 存储/序列化形态恒为 <barsoul-card data-card="..."> —— nh3 子集安全
    return ["barsoul-card", mergeAttributes(HTMLAttributes)];
  },
});
