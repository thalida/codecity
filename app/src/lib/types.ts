export type TCodeCityTree = {
  [path: string]: TCodeCityNode;
}

export type TCodeCityNode = TCodeCityBlobNode | TCodeCityTreeNode;

export type TCodeCityBlobNode = {
  node_type: "blob";
  path: string;
  name: string;
  parent_path: (string | null);
  ancestor_paths: (Array<string> | null);
  depth: number;
  revision_stats: TCodeCityRevisionStats;
  suffix: (string | null);
  suffixes: (Array<string> | null);
  mime_type: string;
  size: number;
  num_lines: (number | null);
}


export type TCodeCityTreeNode = {
  node_type: "tree";
  path: string;
  name: string;
  parent_path: (string | null);
  ancestor_paths: (Array<string> | null);
  depth: number;
  revision_stats: TCodeCityRevisionStats;
  is_root?: boolean;
  num_child_blobs: number;
  num_child_trees: number;

  // Created on frontend
  child_paths: Array<string>;
};



export type TCodeCityRepoOverview = {
  url: string;
  name?: (string | null);
  description?: (string | null);
  created_at?: (string | null);
  updated_at?: (string | null);
};


export type TCodeCityRevisionStats = {
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

export type TCodeCityGrid = {
  [x: number]: {
    [y: number]: TCodeCityGridTile;
  };
}

export type TCodeCityGridTile = {
  tileType: TILE_TYPE;
  nodePath: string;
  parentPath: (string | null);
}

export type TCodeCityGridCombineError = {
  error: true;
  errorReason: {
    isOverlappingRoad: boolean;
    isOccupied: boolean;
    tx: number;
    ty: number;
  };
}


export enum TILE_TYPE {
  DIR_START = 1,
  DIR_END = 2,
  ROAD = 3,
  CROSSWALK = 4,
  INTERSECTION = 5,
  BUIlDING = 6,
  BUILDING_FOUNDATION = 7,
}
