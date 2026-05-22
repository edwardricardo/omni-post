/**
 * @file AvailableProvidersGrid.tsx
 * @description Card grid of providers the user can connect. Each card
 *              shows brand color, display name, auth type, capabilities,
 *              and a Connect / Beta / Coming-soon CTA based on the
 *              provider's lifecycle status.
 * @component AvailableProvidersGrid
 * @layer infrastructure
 */
"use client";

import { useTranslations } from "next-intl";
import type { ProviderMetadata, ProviderCapabilities } from "@shared/types";

const STATUS_BADGE_COLORS: Record<ProviderMetadata["status"], string> = {
  active: "bg-green-100 text-green-800",
  beta: "bg-blue-100 text-blue-800",
  coming_soon: "bg-gray-100 text-gray-800",
  maintenance: "bg-orange-100 text-orange-800",
};

function ProviderStatusBadge({ status }: { status: ProviderMetadata["status"] }) {
  const t = useTranslations("channels.components.providersGrid");
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_BADGE_COLORS[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

interface AvailableProvidersGridProps {
  providers: ProviderMetadata[];
  onConnect: (provider: ProviderMetadata) => void;
}

export function AvailableProvidersGrid({ providers, onConnect }: AvailableProvidersGridProps) {
  const t = useTranslations("channels.components.providersGrid");
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {providers.map((provider) => (
        <div
          key={provider.id}
          className="bg-white rounded-lg shadow-md overflow-hidden border hover:shadow-lg transition-shadow"
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-medium mr-3"
                  style={{ backgroundColor: provider.color }}
                >
                  {provider.displayName.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{provider.displayName}</h3>
                  <p className="text-sm text-gray-500">{provider.authType.toUpperCase()}</p>
                </div>
              </div>
              <ProviderStatusBadge status={provider.status} />
            </div>

            <p className="text-sm text-gray-600 mb-4">{provider.description}</p>

            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  {t("capabilitiesHeading")}
                </h4>
                <div className="flex flex-wrap gap-1">
                  {(
                    Object.entries(provider.capabilities) as [keyof ProviderCapabilities, boolean][]
                  ).map(
                    ([key, enabled]) =>
                      enabled && (
                        <span
                          key={key}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-sm"
                        >
                          {t(`capabilities.${key}`)}
                        </span>
                      )
                  )}
                </div>
              </div>

              <div className="pt-4">
                {provider.status === "active" ? (
                  <button
                    onClick={() => onConnect(provider)}
                    className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-sm hover:bg-blue-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    aria-label={t("connectAria", { name: provider.displayName })}
                  >
                    {t("connect", { name: provider.displayName })}
                  </button>
                ) : provider.status === "beta" ? (
                  <button
                    onClick={() => onConnect(provider)}
                    className="w-full px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-sm hover:bg-orange-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                    aria-label={t("connectBetaAria", { name: provider.displayName })}
                  >
                    {t("connectBeta")}
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full px-4 py-2 bg-gray-300 text-gray-500 text-sm font-medium rounded-sm cursor-not-allowed"
                    aria-label={t("unavailableAria", {
                      name: provider.displayName,
                      status: t(`status.${provider.status}`),
                    })}
                    aria-disabled="true"
                  >
                    {t(`status.${provider.status}`)}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
