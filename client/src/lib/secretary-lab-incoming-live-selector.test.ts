import { it,expect,vi,afterEach } from "vitest";
import React,{ createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IncomingSecretaryDevBench } from "../components/incoming-secretary-dev-bench";
afterEach(()=>vi.unstubAllGlobals());

it("renders Live as the only visible choice and names its backend",()=>{
  // SSR does not run effects, acquire a microphone or make authenticated requests.
  // The Node Vitest transform uses classic JSX; Vite uses its React JSX plugin.
  vi.stubGlobal("React",React);
  const html=renderToStaticMarkup(createElement(IncomingSecretaryDevBench,{
    token:"synthetic-not-a-credential",numberId:"synthetic-work",
  }));
  expect(html).toMatch(/<option[^>]*value="gpt-live-1"[^>]*selected=/);
  expect(html).not.toContain('value="gpt-realtime-2.1"');
  expect(html).toContain("gpt-6.1-sol");
  expect(html).toContain("Запустить тест");
  expect(html).not.toContain("synthetic-not-a-credential");
});
