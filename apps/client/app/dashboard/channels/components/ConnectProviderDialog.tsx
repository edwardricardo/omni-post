/**
 * @file ConnectProviderDialog.tsx
 * @description Modal triggered from the providers grid. For Bluesky,
 *              renders an App Password form and uses `useConnectBluesky`
 *              to call the backend; for OAuth providers it currently
 *              acts as a placeholder ("Connect Account" closes the
 *              dialog — actual OAuth redirect lives in PR-18 / L-94).
 * @component ConnectProviderDialog
 * @layer infrastructure
 */

import { useEffect, useId, useState } from "react";
import type { ProviderMetadata } from "@shared/types";
import { toast } from "@packages/ui";
import { useConnectBluesky } from "@/lib/hooks/useProjectChannels";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface ConnectProviderDialogProps {
  provider: ProviderMetadata;
  projectId: string | undefined;
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export function ConnectProviderDialog({
  provider,
  projectId,
  open,
  onClose,
  onConnected,
}: ConnectProviderDialogProps) {
  const [blueskyHandle, setBlueskyHandle] = useState("");
  const [blueskyAppPassword, setBlueskyAppPassword] = useState("");
  const [blueskyError, setBlueskyError] = useState<string | null>(null);
  const blueskyHandleId = useId();
  const blueskyAppPasswordId = useId();
  const modalRef = useFocusTrap<HTMLDivElement>(open);
  const connectBluesky = useConnectBluesky();

  useEffect(() => {
    if (open) {
      setBlueskyHandle("");
      setBlueskyAppPassword("");
      setBlueskyError(null);
    }
  }, [open, provider.id]);

  if (!open) return null;

  const handleBlueskyConnect = async () => {
    if (!blueskyHandle.trim() || !blueskyAppPassword.trim()) {
      setBlueskyError("Handle y App Password son obligatorios.");
      return;
    }
    if (!projectId) {
      setBlueskyError("No active project — refresh the page and try again.");
      return;
    }
    setBlueskyError(null);
    try {
      await connectBluesky.mutateAsync({
        projectId,
        identifier: blueskyHandle.trim(),
        appPassword: blueskyAppPassword.trim(),
      });
      toast({ title: "Bluesky connected" });
      onConnected();
      onClose();
    } catch (err) {
      setBlueskyError(err instanceof Error ? err.message : "Handle o App Password inválido.");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-modal-title"
    >
      <button
        type="button"
        aria-label="Close connect provider dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div ref={modalRef} className="relative bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="connect-modal-title" className="text-xl font-semibold text-gray-900">
            Connect {provider.displayName}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-sm"
            aria-label="Close connect provider dialog"
          >
            ✕
          </button>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-600 mb-4">
            Connect your {provider.displayName} account to start publishing content.
          </p>

          {provider.id === "instagram" && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex">
                <div className="text-blue-600 mr-2">ℹ️</div>
                <div>
                  <p className="text-sm text-blue-800 font-medium">Instagram Requirements</p>
                  <p className="text-xs text-blue-700 mt-1">
                    You need a Business or Creator account connected to a Facebook Page. Personal
                    accounts are not supported by the Instagram Graph API.
                  </p>
                </div>
              </div>
            </div>
          )}

          {provider.id === "bluesky" && (
            <div className="space-y-4">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                <p className="text-sm text-sky-800 font-medium">App Password requerido</p>
                <p className="text-xs text-sky-700 mt-1">
                  Bluesky usa App Passwords en lugar de OAuth. Genera una en{" "}
                  <a
                    href="https://bsky.app/settings/app-passwords"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium"
                  >
                    bsky.app/settings/app-passwords →
                  </a>
                </p>
              </div>
              <div>
                <label
                  htmlFor={blueskyHandleId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Handle
                </label>
                <input
                  id={blueskyHandleId}
                  type="text"
                  value={blueskyHandle}
                  onChange={(e) => setBlueskyHandle(e.target.value)}
                  placeholder="tuusuario.bsky.social"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label
                  htmlFor={blueskyAppPasswordId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  App Password
                </label>
                <input
                  id={blueskyAppPasswordId}
                  type="password"
                  value={blueskyAppPassword}
                  onChange={(e) => setBlueskyAppPassword(e.target.value)}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              {blueskyError && <p className="text-sm text-red-600">{blueskyError}</p>}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Required Permissions:</h3>
            <ul className="text-xs text-gray-600 space-y-1">
              {provider.id === "x" && (
                <>
                  <li>• Read and write tweets</li>
                  <li>• Access user profile information</li>
                  <li>• Upload media</li>
                </>
              )}
              {provider.id === "instagram" && (
                <>
                  <li>• Manage Instagram content</li>
                  <li>• Access Instagram insights</li>
                  <li>• Publish photos and videos</li>
                  <li>• Access connected Facebook Pages</li>
                </>
              )}
            </ul>
          </div>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-sm hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-label="Cancel connection"
          >
            Cancel
          </button>
          {provider.id === "bluesky" ? (
            <button
              onClick={handleBlueskyConnect}
              disabled={connectBluesky.isPending}
              className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-sm hover:bg-sky-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              aria-label="Conectar cuenta de Bluesky"
            >
              {connectBluesky.isPending ? "Conectando..." : "Conectar Bluesky"}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={`Connect ${provider.displayName} account`}
              title="OAuth flow — will redirect to provider authorization page"
            >
              Connect Account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
