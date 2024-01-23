import { PUBLIC_API_URL } from '$env/static/public';
import type { TCodeCityBlobNode, TCodeCityTreeNode } from "$lib/types";

export const ssr = false;
export async function load({ fetch, url }) {
  const repoUrl = url.searchParams.get('repo');

  if (!repoUrl) {
    return {
      status: 400,
      body: {
        error: 'No repo URL provided',
      },
    };
  }

  return {
    // repoOverview: await getRepoOverview(fetch, repoUrl),
    repoTreeStream: getRepoTreeStream(fetch, repoUrl),
  }
}

async function getRepoOverview(fetcher: typeof fetch, repoUrl: string) {
  const queryParam = new URLSearchParams({ repo_url: repoUrl })
  const requestUrl = `${PUBLIC_API_URL}/repo-overview?${queryParam}`

  const res = await fetcher(
    requestUrl,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  return res.json();
}

const getRepoTreeStream = async (fetcher: typeof fetch, repoUrl: string): Promise<AsyncIterable<string>> => {
  const queryParam = new URLSearchParams({ repo_url: repoUrl })
  const requestUrl = `${PUBLIC_API_URL}/repo-tree?${queryParam}`
  const response = await fetcher(
    requestUrl,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  )
  if (response.status !== 200) throw new Error(response.status.toString())
  if (!response.body) throw new Error('Response body does not exist')

  return getIterableTreeStream(response.body)
}


async function* getIterableTreeStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    const decodedChunk = decoder.decode(value, { stream: true })
    yield decodedChunk
  }
}
