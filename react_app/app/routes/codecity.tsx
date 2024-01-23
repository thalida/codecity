import {
  useLoaderData, useSearchParams,
} from "@remix-run/react";
import type {
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { getRepoTreeStream, getRepoOverview } from "~/api";
import CodeCityScene from "~/components/CodeCityScene";
import { ICodeCityBlobNode, ICodeCityTreeNode } from "~/types/codecity";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");

  if (!q) {
    throw new Response("Not Found", { status: 404 });
  }

  // const repoOverview = (await getRepoOverview(q)).data;
  const repoOverview = {}

  return json({ repoOverview });
};


function reducer(state: Record<string, ICodeCityBlobNode | ICodeCityTreeNode>, action: { type: string, payload: ICodeCityBlobNode | ICodeCityTreeNode }) {
  const updatedState: Record<string, ICodeCityBlobNode | ICodeCityTreeNode> = {};

  switch (action.type) {
    case "add":
      updatedState[action.payload.path] = action.payload;

      if (action.payload.ancestor_paths) {
        for (let i = 0; i < action.payload.ancestor_paths.length; i += 1) {
          const ancestorPath = action.payload.ancestor_paths[i];
          const ancestorNode = state[ancestorPath] as ICodeCityTreeNode;

          if (!ancestorNode) {
            continue;
          }

          ancestorNode.child_paths = ancestorNode.child_paths ?? [];
          ancestorNode.child_paths.push(action.payload.path);

          updatedState[ancestorNode.path] = ancestorNode;
        }
      }

      return {
        ...state,
        ...updatedState,
      };
    default:
      throw new Error();
  }
}


export default function CodeCity() {
  const [searchParams] = useSearchParams();
  const { repoOverview } = useLoaderData<typeof loader>();
  const [nodes, dispatch] = useReducer(reducer, {});

  useEffect(() => {
    const q = searchParams.get("q");

    if (!q) {
      throw new Response("Not Found", { status: 404 });
    }

    async function getStream(repoUrl: string) {
      const stream = await getRepoTreeStream(repoUrl)
      for await (const node of stream) {
        dispatch({ type: "add", payload: node as ICodeCityBlobNode | ICodeCityTreeNode });
        // setLatestNode(node as ICodeCityBlobNode | ICodeCityTreeNode);
      }
    }

    getStream(q);
  }, [searchParams]);

  return (
    <div id="codecity">
      <div>
        Codecity
      </div>

      <div>
        {repoOverview?.url}
        {repoOverview?.name}
        {repoOverview?.description}
      </div>

      <CodeCityScene nodes={nodes} />
    </div>
  );
}
