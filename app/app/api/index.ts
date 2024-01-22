import axios, { AxiosResponse } from "axios";
import { CodeCityBlobNode, CodeCityRepoOverview, CodeCityTreeNode } from "./client";

export async function getRepoOverview(repoUrl: string) {
  const baseURL: string | undefined = process.env.API_URL;
  return axios.request<unknown, AxiosResponse<CodeCityRepoOverview>>({
    method: 'GET',
    url: `${baseURL}/repo-overview`,
    params: { repo_url: repoUrl },
    headers: { Accept: 'application/json' }
  });
}

// <unknown, AxiosResponse < Array < CodeCityTreeNode | CodeCityBlobNode >>>

export const getRepoTreeStream = async (repoUrl: string): Promise<AsyncIterable<CodeCityBlobNode | CodeCityTreeNode>> => {
  const baseURL: string | undefined = window.ENV.API_URL;
  const queryParam = new URLSearchParams({ repo_url: repoUrl })
  const requestUrl = `${baseURL}/repo-tree?${queryParam}`
  const response = await fetch(
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


export async function* getIterableTreeStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<CodeCityBlobNode | CodeCityTreeNode> {
  const reader = body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    const decodedChunk = decoder.decode(value, { stream: true })
    const node: CodeCityBlobNode | CodeCityTreeNode = JSON.parse(decodedChunk)
    yield node
  }
}
