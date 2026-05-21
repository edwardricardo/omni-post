/**
 * @file ConnectProviderDialog.tsx
 * @description Modal triggered from the providers grid. For Bluesky,
 *              renders an App Password form and uses `useConnectBluesky`
 *              to call the backend; for OAuth providers it currently
 *              acts as a placeholder ("Connect Account" closes the
 *              dialog — the OAuth redirect itself is not wired here).
 * @component ConnectProviderDialog
 * @layer infrastructure
 */

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("channels");
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
      setBlueskyError(t("components.connect.bluesky.requiredFields"));
      return;
    }
    if (!projectId) {
      setBlueskyError(t("components.connect.noActiveProject"));
      return;
    }
    setBlueskyError(null);
    try {
      await connectBluesky.mutateAsync({
        projectId,
        identifier: blueskyHandle.trim(),
        appPassword: blueskyAppPassword.trim(),
      });
      toast({ title: t("components.connect.bluesky.connected") });
      onConnected();
      onClose();
    } catch (err) {
      setBlueskyError(
        err instanceof Error ? err.message : t("components.connect.bluesky.invalidCredentials")
      );
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
        aria-label={t("components.connect.closeDialog")}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div ref={modalRef} className="relative bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="connect-modal-title" className="text-xl font-semibold text-gray-900">
            {t("components.connect.title", { provider: provider.displayName })}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-sm"
            aria-label={t("components.connect.closeDialog")}
          >
            ✕
          </button>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-600 mb-4">
            {t("components.connect.description", { provider: provider.displayName })}
          </p>

          {provider.id === "instagram" && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex">
                <div className="text-blue-600 mr-2">ℹ️</div>
                <div>
                  <p className="text-sm text-blue-800 font-medium">
                    {t("components.connect.instagram.requirementsTitle")}
                  </p>
                  <p className="text-xs text-blue-700 mt-1">
                    {t("components.connect.instagram.requirementsDescription")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {provider.id === "bluesky" && (
            <div className="space-y-4">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                <p className="text-sm text-sky-800 font-medium">
                  {t("components.connect.bluesky.appPasswordTitle")}
                </p>
                <p className="text-xs text-sky-700 mt-1">
                  {t.rich("components.connect.bluesky.appPasswordDescription", {
                    link: (chunks) => (
                      <a
                        href="https://bsky.app/settings/app-passwords"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-medium"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </div>
              <div>
                <label
                  htmlFor={blueskyHandleId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t("components.connect.bluesky.handleLabel")}
                </label>
                <input
                  id={blueskyHandleId}
                  type="text"
                  value={blueskyHandle}
                  onChange={(e) => setBlueskyHandle(e.target.value)}
                  placeholder={t("components.connect.bluesky.handlePlaceholder")}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label
                  htmlFor={blueskyAppPasswordId}
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t("components.connect.bluesky.appPasswordLabel")}
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
            <h3 className="text-sm font-medium text-gray-700">
              {t("components.connect.permissions.heading")}
            </h3>
            <ul className="text-xs text-gray-600 space-y-1">
              {provider.id === "x" && (
                <>
                  <li>• {t("components.connect.permissions.x.readWrite")}</li>
                  <li>• {t("components.connect.permissions.x.profile")}</li>
                  <li>• {t("components.connect.permissions.x.media")}</li>
                </>
              )}
              {provider.id === "instagram" && (
                <>
                  <li>• {t("components.connect.permissions.instagram.manageContent")}</li>
                  <li>• {t("components.connect.permissions.instagram.insights")}</li>
                  <li>• {t("components.connect.permissions.instagram.publish")}</li>
                  <li>• {t("components.connect.permissions.instagram.facebookPages")}</li>
                </>
              )}
            </ul>
          </div>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-sm hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            aria-label={t("components.connect.cancelAria")}
          >
            {t("components.connect.cancel")}
          </button>
          {provider.id === "bluesky" ? (
            <button
              onClick={handleBlueskyConnect}
              disabled={connectBluesky.isPending}
              className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-sm hover:bg-sky-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              aria-label={t("components.connect.bluesky.connectAria")}
            >
              {connectBluesky.isPending
                ? t("components.connect.bluesky.connecting")
                : t("components.connect.bluesky.connectButton")}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={t("components.connect.connectAccountAria", {
                provider: provider.displayName,
              })}
              title={t("components.connect.oauthTitle")}
            >
              {t("components.connect.connectAccount")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
