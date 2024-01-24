import { PUBLIC_API_URL } from '$env/static/public';
import type { TCodeCityNode } from "$lib/types";

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
    repoTreeStream: await getRepoTreeStream(fetch, repoUrl),
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


const getRepoTreeStream = async (fetcher: typeof fetch, repoUrl: string) => {
  const queryParam = new URLSearchParams({ repo_url: repoUrl })
  const requestUrl = `${PUBLIC_API_URL}/repo-tree?${queryParam}`
  const response = await fetcher(
    requestUrl,
    {
      method: 'GET',
      headers: { Accept: 'application/x-ndjson' },
    }
  )
  if (response.status !== 200) throw new Error(response.status.toString())
  if (!response.body) throw new Error('Response body does not exist')

  return getIterableTreeStream(response.body)
}


async function* getIterableTreeStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<TCodeCityNode> {

  const reader = body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    const decodedChunk = decoder.decode(value, { stream: true });

    try {
      const splitChunks = decodedChunk.split('\n');

      for (let i = 0; i < splitChunks.length; i += 1) {
        const chunk = splitChunks[i];
        if (chunk.length === 0) {
          continue;
        }

        const node = JSON.parse(chunk) as TCodeCityNode;
        yield node;
      }
    } catch (e) {
      console.error(e);
    }
  }
}
