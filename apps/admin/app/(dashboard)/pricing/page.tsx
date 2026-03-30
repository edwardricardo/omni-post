/**
 * @file page.tsx
 * @description Admin pricing management page with tier editing and MRR dashboard.
 * @layer admin-pages
 */

"use client";

import { useState } from "react";
import { Button } from "@packages/ui";

const PROVIDER_TIERS = [
  { min: 1, max: 1, price: "$12.00" },
  { min: 2, max: 3, price: "$10.00" },
  { min: 4, max: 6, price: "$8.00" },
  { min: 7, max: 10, price: "$6.00" },
];

const ACCOUNT_TIERS = [
  { min: 1, max: 1, multiplier: "1.000" },
  { min: 2, max: 3, multiplier: "0.800" },
  { min: 4, max: 9, multiplier: "0.650" },
  { min: 10, max: null, multiplier: "0.500" },
];

const BUNDLES = [
  { name: "Creator", providers: "X, Instagram, YouTube", price: "$25.00" },
  { name: "Social Pro", providers: "X, Instagram, Facebook, LinkedIn", price: "$32.00" },
  { name: "Agency Full", providers: "All 10 platforms", price: "$55.00" },
];

export default function PricingPage() {
  const [activeTab, setActiveTab] = useState<"providers" | "accounts" | "bundles" | "mrr">(
    "providers"
  );

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-2">Pricing Management</h1>
      <p className="text-sm text-gray-500 mb-6">
        Configure provider tiers, account discounts, and bundles. Price changes trigger
        grandfathering for existing customers.
      </p>

      <div className="flex border-b mb-6">
        {(["providers", "accounts", "bundles", "mrr"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500"
            }`}
          >
            {tab === "mrr" ? "MRR Dashboard" : tab}
          </button>
        ))}
      </div>

      {activeTab === "providers" && (
        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold mb-3">Provider Pricing Tiers</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 px-3 font-medium">Min Providers</th>
                <th className="py-2 px-3 font-medium">Max Providers</th>
                <th className="py-2 px-3 font-medium">Price/Provider/Month</th>
                <th className="py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDER_TIERS.map((tier) => (
                <tr key={tier.min} className="border-b">
                  <td className="py-2 px-3">{tier.min}</td>
                  <td className="py-2 px-3">{tier.max}</td>
                  <td className="py-2 px-3 font-mono">{tier.price}</td>
                  <td className="py-2 px-3">
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "accounts" && (
        <div className="bg-white rounded-lg border p-4">
          <h2 className="font-semibold mb-3">Account Volume Discounts</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 px-3 font-medium">Min Accounts</th>
                <th className="py-2 px-3 font-medium">Max Accounts</th>
                <th className="py-2 px-3 font-medium">Multiplier</th>
                <th className="py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNT_TIERS.map((tier) => (
                <tr key={tier.min} className="border-b">
                  <td className="py-2 px-3">{tier.min}</td>
                  <td className="py-2 px-3">{tier.max ?? "No limit"}</td>
                  <td className="py-2 px-3 font-mono">{tier.multiplier}</td>
                  <td className="py-2 px-3">
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "bundles" && (
        <div className="space-y-4">
          {BUNDLES.map((bundle) => (
            <div
              key={bundle.name}
              className="bg-white rounded-lg border p-4 flex items-center justify-between"
            >
              <div>
                <h3 className="font-semibold">{bundle.name}</h3>
                <p className="text-sm text-gray-500">{bundle.providers}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono font-semibold">{bundle.price}/account/mo</span>
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "mrr" && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Monthly Recurring Revenue</p>
            <p className="text-2xl font-bold mt-1">$0</p>
            <p className="text-xs text-gray-400 mt-1">No active subscriptions yet</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Active Subscriptions</p>
            <p className="text-2xl font-bold mt-1">0</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Grandfathered Revenue</p>
            <p className="text-2xl font-bold mt-1">$0</p>
            <p className="text-xs text-gray-400 mt-1">
              Revenue at old prices during notification window
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
