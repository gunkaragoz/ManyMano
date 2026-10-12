import { RouterContextProvider, createContext, type ServerBuild } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createCachedRequestHandler } from "~/utils/request-handler";

const build = {} as ServerBuild;
const request = () => new Request("https://example.com/create/poll");

describe("production request handler initialization", () => {
  it("loads and derives the handler once while passing each request's context separately", async () => {
    const key = createContext<string>();
    const first = new RouterContextProvider();
    first.set(key, "first environment");
    const second = new RouterContextProvider();
    second.set(key, "second environment");
    const load = vi.fn(async () => build);
    const handle = vi.fn(async (_request: Request, context?: RouterContextProvider) =>
      new Response(context!.get(key))
    );
    const factory = vi.fn(() => handle);
    const handler = createCachedRequestHandler(load, "production", factory);
    expect(load).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([handler(request(), first), handler(request(), second)]);
    expect(await a.text()).toBe("first environment");
    expect(await b.text()).toBe("second environment");
    await handler(request(), first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledExactlyOnceWith(build, "production");
    expect(handle).toHaveBeenCalledTimes(3);
  });

  it("keeps the build callback for development hot reloads", async () => {
    const load = vi.fn(async () => build);
    const factory = vi.fn(() => vi.fn(async () => new Response("development")));
    const handler = createCachedRequestHandler(load, "development", factory);
    expect(factory).toHaveBeenCalledExactlyOnceWith(load, "development");
    await handler(request());
    expect(load).not.toHaveBeenCalled(); // React Router owns callback invocation.
  });

  it("retries initialization after a failed import rather than caching the failure", async () => {
    const load = vi.fn<() => Promise<ServerBuild>>()
      .mockRejectedValueOnce(new Error("temporary import failure"))
      .mockResolvedValue(build);
    const factory = vi.fn(() => vi.fn(async () => new Response("ok")));
    const handler = createCachedRequestHandler(load, "production", factory);
    await expect(handler(request())).rejects.toThrow("temporary import failure");
    expect(await (await handler(request())).text()).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
