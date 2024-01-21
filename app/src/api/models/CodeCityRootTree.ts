/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CodeCityBlobNode } from './CodeCityBlobNode';
import type { CodeCityTreeNode } from './CodeCityTreeNode';
export type CodeCityRootTree = {
    root_path: string;
    /**
     * A mapping of node paths to node objects.
     */
    nodes?: Record<string, (CodeCityTreeNode | CodeCityBlobNode)>;
};

