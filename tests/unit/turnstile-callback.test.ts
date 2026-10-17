// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import Turnstile from "../../app/components/Turnstile";

afterEach(() => {
  cleanup();
  delete window.turnstile;
});

it("passes a completed challenge token to the form callback once", async () => {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const renderWidget = vi.fn((_container: HTMLElement, _options: Record<string, unknown>) => "widget-1");
  window.turnstile = {
    render: renderWidget,
    reset: vi.fn(),
    remove: vi.fn(),
  };

  render(createElement(Turnstile, { siteKey: "test-key", action: "event-signup", onSuccess, onError }));
  await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());

  const options = renderWidget.mock.calls[0]?.[1] as {
    callback: (token: string) => void;
    "error-callback": () => void;
  };
  options.callback("verified-token");
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith("verified-token");
  options["error-callback"]();
  expect(onError).toHaveBeenCalledOnce();
});
