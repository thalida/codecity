import {
  useLoaderData, useSearchParams,
} from "@remix-run/react";
import type {
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { getRepoTreeStream, getRepoOverview } from "~/api";
import { useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");

  if (!q) {
    throw new Response("Not Found", { status: 404 });
  }

  const repoOverview = (await getRepoOverview(q)).data;

  return json({ repoOverview });

};

export default function CodeCity() {
  const [searchParams] = useSearchParams();
  const { repoOverview } = useLoaderData<typeof loader>();

  useEffect(() => {

    async function getStream() {
      const q = searchParams.get("q");

      if (!q) {
        throw new Response("Not Found", { status: 404 });
      }

      const stream = await getRepoTreeStream(q)
      for await (const node of stream) {
        console.log(node)
      }
    }

    getStream();

  });

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
    </div>
  );
}
