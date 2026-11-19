import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { computeObsAuth, switchObsScene, testObsConnection } from "./obs.ts";

describe("OBS WebSocket v5 client", () => {
  const servers: WebSocketServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((ok) => s.close(() => ok()))));
    servers.length = 0;
  });

  function startMockObs(password: string | null) {
    const wss = new WebSocketServer({ port: 0 });
    servers.push(wss);
    const switched: string[] = [];

    wss.on("connection", (ws) => {
      const challenge = "mock-challenge";
      const salt = "mock-salt";
      ws.send(
        JSON.stringify({
          op: 0,
          d: {
            obsWebSocketVersion: "5.4.0",
            rpcVersion: 1,
            ...(password ? { authentication: { challenge, salt } } : {}),
          },
        }),
      );

      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> };
        if (msg.op === 1) {
          if (password) {
            const expected = computeObsAuth(password, salt, challenge);
            if (msg.d.authentication !== expected) {
              ws.close(4009, "Authentication failed");
              return;
            }
          }
          ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        } else if (msg.op === 6) {
          const requestId = String(msg.d.requestId);
          const requestType = String(msg.d.requestType);
          if (requestType === "GetSceneList") {
            ws.send(
              JSON.stringify({
                op: 7,
                d: {
                  requestType,
                  requestId,
                  requestStatus: { result: true, code: 100 },
                  responseData: {
                    currentProgramSceneName: "Coding",
                    scenes: [{ sceneName: "Coding" }, { sceneName: "Voting" }],
                  },
                },
              }),
            );
          } else if (requestType === "SetCurrentProgramScene") {
            const name = String((msg.d.requestData as { sceneName?: string })?.sceneName ?? "");
            switched.push(name);
            ws.send(
              JSON.stringify({
                op: 7,
                d: {
                  requestType,
                  requestId,
                  requestStatus: { result: true, code: 100 },
                  responseData: {},
                },
              }),
            );
          }
        }
      });
    });

    const port = (wss.address() as AddressInfo).port;
    return { url: `ws://127.0.0.1:${port}`, switched };
  }

  it("authenticates with SHA-256 challenge, lists scenes, and switches program scene", async () => {
    const mock = startMockObs("obs-secret");

    const bad = await testObsConnection({ url: mock.url, password: "wrong", timeoutMs: 2000 });
    expect(bad.ok).toBe(false);

    const res = await testObsConnection({ url: mock.url, password: "obs-secret", timeoutMs: 2000 });
    expect(res).toEqual({
      ok: true,
      scenes: ["Coding", "Voting"],
      currentScene: "Coding",
    });

    await switchObsScene({ url: mock.url, password: "obs-secret", timeoutMs: 2000 }, "Voting");
    expect(mock.switched).toEqual(["Voting"]);
  });
});
