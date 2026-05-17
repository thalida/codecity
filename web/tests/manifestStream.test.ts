import { describe, it, expect } from 'vitest';
import { streamManifest } from '../manifestStream';

function mockResponse(chunks: string[], status = 200, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers });
}

describe('streamManifest', () => {
  it('yields each NDJSON line as an event', async () => {
    const fetchMock = async () => mockResponse([
      '{"phase":"skeleton","manifest":{"x":1}}\n',
      '{"phase":"final","manifest":{"x":2}}\n',
    ]);
    const events = [];
    for await (const ev of streamManifest('http://x', fetchMock as typeof fetch)) {
      events.push(ev);
    }
    expect(events).toHaveLength(2);
    expect(events[0].phase).toBe('skeleton');
    expect(events[1].phase).toBe('final');
  });

  it('reassembles a line split across chunks', async () => {
    const fetchMock = async () => mockResponse([
      '{"phase":"skel',
      'eton","manifest":{}}\n',
    ]);
    const events = [];
    for await (const ev of streamManifest('http://x', fetchMock as typeof fetch)) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe('skeleton');
  });

  it('yields a final line without a trailing newline', async () => {
    const fetchMock = async () => mockResponse([
      '{"phase":"final","manifest":{}}',
    ]);
    const events = [];
    for await (const ev of streamManifest('http://x', fetchMock as typeof fetch)) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
  });

  it('rejects on a non-2xx response', async () => {
    const fetchMock = async () => new Response(
      JSON.stringify({ error: 'boom' }),
      { status: 500 },
    );
    await expect(async () => {
      for await (const _ of streamManifest('http://x', fetchMock as typeof fetch)) {
        /* unreachable */
      }
    }).rejects.toThrow('boom');
  });
});
