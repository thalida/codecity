/* generated using openapi-typescript-codegen -- do no edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CodeCityRevisionStats = {
    num_commits: number;
    num_contributors: number;
    /**
     * Last commit datetime
     */
    updated_on: (string | null);
    /**
     * First commit datetime
     */
    created_on: (string | null);
    /**
     * The median of all commit datetimes
     */
    median_updated_on: (string | null);
    /**
     * How old is the node relative to the age of the repo. A float between 0 and 1, where 0 is new and 1 is old.
     */
    local_age: (number | null);
    /**
     * How active is this node, based on last commit, relative to the last commit in the repo. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.
     */
    local_maintenance: (number | null);
    /**
     * How active is this node, based on median commit datetime, relative to the last commit in the repo. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.
     */
    local_median_maintenance: (number | null);
    /**
     * How old is the node relative to the current date. A float between 0 and 1, where 0 is new and 1 is old.
     */
    global_age: (number | null);
    /**
     * How active is this node, based on last commit, relative to current date. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.
     */
    global_maintenance: (number | null);
    /**
     * How active is this node, based on median commit datetime, relative to current date. A float between 0 and 1, where 0 is not maintained and 1 is actively maintained.
     */
    global_median_maintenance: (number | null);
};

