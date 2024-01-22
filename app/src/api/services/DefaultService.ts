/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CodeCityBlobNode } from '../models/CodeCityBlobNode';
import type { CodeCityRepoOverview } from '../models/CodeCityRepoOverview';
import type { CodeCityTreeNode } from '../models/CodeCityTreeNode';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DefaultService {
    /**
     * Get Repo Overview
     * @returns CodeCityRepoOverview Successful Response
     * @throws ApiError
     */
    public static getRepoOverview({
        repoUrl,
    }: {
        repoUrl: string,
    }): CancelablePromise<CodeCityRepoOverview> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/repo-overview',
            query: {
                'repo_url': repoUrl,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Repo Tree
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getRepoTree({
        repoUrl,
    }: {
        repoUrl: string,
    }): CancelablePromise<Array<(CodeCityTreeNode | CodeCityBlobNode)>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/repo-tree',
            query: {
                'repo_url': repoUrl,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
