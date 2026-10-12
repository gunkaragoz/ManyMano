import { createRequestHandler, type ServerBuild } from "react-router";

// A build callback makes React Router derive its route tree on every request.
// Keep it for HMR, but lazily reuse an immutable build/handler in production.
export function createCachedRequestHandler(
  loadBuild: () => Promise<ServerBuild>,
  mode: string,
  createHandler: typeof createRequestHandler = createRequestHandler
): ReturnType<typeof createRequestHandler> {
  if (mode === "development") return createHandler(loadBuild, mode);
  let handler: Promise<ReturnType<typeof createRequestHandler>> | undefined;
  return async (request, context) => {
    handler ??= loadBuild()
      .then((build) => createHandler(build, mode))
      .catch((error) => {
        handler = undefined;
        throw error;
      });
    return (await handler)(request, context);
  };
}
