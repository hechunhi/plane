/**
 * BARSOUL: barsoulCard 节点 = config + React NodeView。
 * 镜像 callout 的 ReactNodeViewRenderer 模式。
 */
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BarsoulCardBlock } from "./block";
import { BarsoulCardExtensionConfig } from "./extension-config";

export const BarsoulCardExtension = BarsoulCardExtensionConfig.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BarsoulCardBlock);
  },
});
