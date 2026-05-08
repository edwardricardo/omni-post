/**
 * @file SetPrimaryChannelButton.integration.test.tsx
 * @description Integration tests for the inline "Set as primary" button.
 *              Verifies the disabled state when already primary, the toast
 *              feedback on success/error, and that clicking issues the right
 *              PATCH request.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetPrimaryChannelButton } from "../../components/channels/SetPrimaryChannelButton";

const toastSpy = vi.fn();
// Fully mock @packages/ui to avoid pulling the whole barrel (which imports
// `usePublishingEngine` -> `@shared/types`, a path Vite cannot resolve in this
// test environment). Only the surface the button uses is mocked.
vi.mock("@packages/ui", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  toast: (args: unknown) => toastSpy(args),
}));

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children, client }: { children: React.ReactNode; client: QueryClient }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockFetch.mockReset();
  toastSpy.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

describe("SetPrimaryChannelButton", () => {
  it("renders disabled when the channel is already primary", () => {
    const client = makeClient();
    render(
      <Wrapper client={client}>
        <SetPrimaryChannelButton channelId="c-1" isPrimary={true} />
      </Wrapper>
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("Primary");
  });

  it("issues PATCH /channels/:id/set-primary on click and toasts on success", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: "c-1", isPrimary: true } })
    );

    const client = makeClient();
    render(
      <Wrapper client={client}>
        <SetPrimaryChannelButton channelId="c-1" isPrimary={false} />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/backend/channels/c-1/set-primary",
        expect.objectContaining({ method: "PATCH", credentials: "include" })
      )
    );
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0]?.[0]).toMatchObject({ title: "Primary channel updated" });
  });

  it("toasts a destructive variant when the request fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "boom" } }, 500));

    const client = makeClient();
    render(
      <Wrapper client={client}>
        <SetPrimaryChannelButton channelId="c-2" isPrimary={false} />
      </Wrapper>
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const toastArgs = toastSpy.mock.calls[0]?.[0] as { variant: string; title: string };
    expect(toastArgs.variant).toBe("destructive");
    expect(toastArgs.title).toBe("Failed to set primary");
  });
});
