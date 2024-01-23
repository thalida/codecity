/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CodeCityRevisionStats } from './CodeCityRevisionStats';
export type CodeCityBlobNode = {
    path: string;
    name: string;
    parent_path: (string | null);
    ancestor_paths: (Array<string> | null);
    depth: number;
    revision_stats: CodeCityRevisionStats;
    node_type: any;
    suffix: (string | null);
    suffixes: (Array<string> | null);
    mime_type: string;
    size: number;
    num_lines: (number | null);
};

