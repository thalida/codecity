/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CodeCityResponse } from '../models/CodeCityResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CodecityService {
    /**
     * Get Codecity
     * @returns CodeCityResponse Successful Response
     * @throws ApiError
     */
    public static getCodecity({
        repoUrl,
    }: {
        repoUrl: string,
    }): CancelablePromise<CodeCityResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/codecity',
            query: {
                'repo_url': repoUrl,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
