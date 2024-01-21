/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CodeCityRevisionStats } from './CodeCityRevisionStats';
export type CodeCityBlobNode = {
    node_type?: any;
    suffix: (string | null);
    suffixes: (Array<string> | null);
    mime_type: string;
    size: number;
    num_lines: (number | null);
    depth: number;
    parent_path: (string | null);
    path: string;
    name: string;
    revision_stats: (CodeCityRevisionStats | null);
};

