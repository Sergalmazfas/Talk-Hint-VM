import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import OpenAI from "openai";
import { speedStream } from "./speedExperiment";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

it.each([false, true])("SDK abort physically closes a local SSE transport (before first text=%s); no external provider", async beforeText => {
  let requests = 0;
  let serverSawClose!: () => void;
  const closed = new Promise<void>(r => { serverSawClose = r; });
  let serverReady!: () => void;
  const ready = new Promise<void>(r => { serverReady = r; });
  let firstBody: any;
  const server = createServer(async (req, res) => {
    requests++;
    let body = "";
    for await (const part of req) body += part;
    firstBody = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "text/event-stream", "x-request-id": "local-fixture-only" });
    res.flushHeaders();
    if (beforeText) res.write(": waiting for a fake model\n\n");
    else res.write('data: {"type":"response.output_text.delta","delta":"Does "}\n\n');
    res.on("close", serverSawClose);
    serverReady();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const port = (server.address() as { port: number }).port;
  const client = new OpenAI({ apiKey: "local-fixture-not-a-secret", baseURL: `http://127.0.0.1:${port}/v1`, maxRetries: 0 });
  const stream = speedStream(client as any, "C", []);
  const controller = new AbortController();
  const run = (async () => {
    try {
      for await (const chunk of stream({ instructions: "Offline test only.", input: [], signal: controller.signal })) {
        if (chunk.type === "text") controller.abort();
      }
    } catch (error) { expect(controller.signal.aborted).toBe(true); }
  })();
  await ready;
  if (beforeText) controller.abort();
  await run;
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(Error("Transport was not closed")), 1000))]);
  expect(requests).toBe(1);
  expect(firstBody).toEqual(expect.objectContaining({
    model: "gpt-6-sol", reasoning: { effort: "low" }, max_output_tokens: 300, stream: true,
  }));
}, 5000);
