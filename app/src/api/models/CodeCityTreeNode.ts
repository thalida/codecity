/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CodeCityRevisionStats } from './CodeCityRevisionStats';
export type CodeCityTreeNode = {
    node_type?: any;
    child_paths: Array<string>;
    num_children: number;
    num_child_blobs: number;
    num_child_trees: number;
    num_descendants: number;
    num_descendant_blobs: number;
    num_descendant_trees: number;
    depth: number;
    parent_path: (string | null);
    path: string;
    name: string;
    revision_stats: (CodeCityRevisionStats | null);
};

