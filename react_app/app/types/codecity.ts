import { CodeCityBlobNode, CodeCityTreeNode } from "~/api/client";

export interface ICodeCityBlobNode extends CodeCityBlobNode {
  node_type: 'blob';
}

export interface ICodeCityTreeNode extends CodeCityTreeNode {
  node_type: 'tree';
  child_paths: string[];
}
