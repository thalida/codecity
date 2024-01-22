/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CodeCityRevisionStats } from './CodeCityRevisionStats';
export type CodeCityTreeNode = {
    path: string;
    name: string;
    parent_path: (string | null);
    ancestor_paths: (Array<string> | null);
    depth: number;
    revision_stats: CodeCityRevisionStats;
    node_type: any;
    is_root?: boolean;
    num_child_blobs: number;
    num_child_trees: number;
};

