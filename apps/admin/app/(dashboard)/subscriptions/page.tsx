/**
 * @file page.tsx
 * @description Subscription management page for the admin dashboard. Lists all subscriber accounts,
 * trial users, and revenue metrics fetched via the useSubscriptions hook.
 */
"use client";

import { useState } from "react";
import { useSubscriptions } from "@/hooks/api/useSubscriptions";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

interface SubscriptionAccount {
  id: string;
  email: string;
  name: string;
  subscription: "BASIC" | "PRO" | "ENTERPRISE";
  billingCycle: "monthly" | "yearly";
  autoRenewal: boolean;
  isOnTrial: boolean;
  trialDaysRemaining: number;
  nextBillingDate: string | null;
  lastBillingDate: string | null;
  revenue: {
    monthlyValue: number;
    totalValue: number;
  };
  createdAt: string;
}

interface TrialAccount {
  id: string;
  email: string;
  name: string;
  subscription: "BASIC" | "PRO" | "ENTERPRISE";
  trialStartDate: string;
  trialEndDate: string;
  trialDaysRemaining: number;
  autoRenewal: boolean;
  status: "ACTIVE" | "EXPIRING" | "EXPIRED";
}

function SubscriptionsPageContent() {
  // Use TanStack Query hook for data fetching
  const { data: subscriptionData, isLoading, error, refetch } = useSubscriptions();

  const [activeTab, setActiveTab] = useState<"subscriptions" | "trials" | "billing">(
    "subscriptions"
  );

  // Extract data from query response with safe defaults
  const subscriptions = (subscriptionData?.subscriptions as SubscriptionAccount[]) || [];
  const trials = (subscriptionData?.trials as TrialAccount[]) || [];
  const stats = subscriptionData?.stats || {
    totalRevenue: 0,
    monthlyRevenue: 0,
    activeSubscriptions: 0,
    activeTrials: 0,
    expiringTrials: 0,
    conversionRate: 0,
  };

  const handleTrialAction = async (_trialId: string, _action: "convert" | "extend" | "end") => {
    // Trial actions require POST /admin/subscriptions/:id/trial-action endpoint (not yet implemented)
    await refetch();
  };

  const handleSubscriptionAction = async (
    _subscriptionId: string,
    _action: "cancel" | "change" | "renew"
  ) => {
    // Subscription actions require POST /admin/subscriptions/:id/action endpoint (not yet implemented)
    await refetch();
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getTrialStatusBadge = (status: string) => {
    const styles = {
      ACTIVE: "bg-green-100 text-green-800",
      EXPIRING: "bg-orange-100 text-orange-800",
      EXPIRED: "bg-red-100 text-red-800",
    };
    return (
      <span
        className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status as keyof typeof styles]}`}
      >
        {status}
      </span>
    );
  };

  const getSubscriptionBadge = (tier: string) => {
    const styles = {
      BASIC: "bg-blue-100 text-blue-800",
      PRO: "bg-green-100 text-green-800",
      ENTERPRISE: "bg-purple-100 text-purple-800",
    };
    return (
      <span
        className={`px-2 py-1 text-xs font-medium rounded-full ${styles[tier as keyof typeof styles]}`}
      >
        {tier}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Subscription Management</h1>
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" label="Loading subscriptions..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Subscription Management</h1>
          <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
            <div className="text-lg text-red-600">Error: {error.message}</div>
            <button
              onClick={() => refetch()}
              className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Retry loading subscriptions"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Subscription Management</h1>
          <div className="flex space-x-4">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Refresh subscriptions data"
            >
              Refresh
            </button>
            <button
              className="px-4 py-2 bg-green-600 text-white rounded-sm hover:bg-green-700 focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              aria-label="Process automatic renewals"
            >
              Process Auto-Renewals
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6 mb-8"
          role="region"
          aria-label="Subscription statistics"
        >
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Total Revenue</div>
            <div className="text-2xl font-bold text-gray-900">
              ${stats.totalRevenue.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Monthly Revenue</div>
            <div className="text-2xl font-bold text-green-600">
              ${stats.monthlyRevenue.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Active Subscriptions</div>
            <div className="text-2xl font-bold text-gray-900">{stats.activeSubscriptions}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Active Trials</div>
            <div className="text-2xl font-bold text-blue-600">{stats.activeTrials}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Expiring Trials</div>
            <div className="text-2xl font-bold text-orange-600">{stats.expiringTrials}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Conversion Rate</div>
            <div className="text-2xl font-bold text-purple-600">{stats.conversionRate}%</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" role="tablist" aria-label="Subscription tabs">
              <button
                onClick={() => setActiveTab("subscriptions")}
                role="tab"
                aria-selected={activeTab === "subscriptions"}
                aria-controls="subscriptions-panel"
                className={`py-4 px-1 border-b-2 font-medium text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  activeTab === "subscriptions"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Active Subscriptions ({stats.activeSubscriptions})
              </button>
              <button
                onClick={() => setActiveTab("trials")}
                role="tab"
                aria-selected={activeTab === "trials"}
                aria-controls="trials-panel"
                className={`py-4 px-1 border-b-2 font-medium text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  activeTab === "trials"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Trial Accounts ({trials.length})
              </button>
              <button
                onClick={() => setActiveTab("billing")}
                role="tab"
                aria-selected={activeTab === "billing"}
                aria-controls="billing-panel"
                className={`py-4 px-1 border-b-2 font-medium text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  activeTab === "billing"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                Billing Events
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {/* Subscriptions Tab */}
            {activeTab === "subscriptions" && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Account
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Plan
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Billing
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Revenue
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Next Bill
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {subscriptions.map((subscription) => (
                      <tr key={subscription.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {subscription.name}
                            </div>
                            <div className="text-sm text-gray-500">{subscription.email}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-2">
                            {getSubscriptionBadge(subscription.subscription)}
                            <span className="text-xs text-gray-500">
                              ({subscription.billingCycle})
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                subscription.autoRenewal
                                  ? "bg-green-100 text-green-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}
                            >
                              {subscription.autoRenewal ? "Auto-Renew" : "Manual"}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              ${subscription.revenue.monthlyValue}/mo
                            </div>
                            <div className="text-xs text-gray-500">
                              ${subscription.revenue.totalValue} total
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {formatDate(subscription.nextBillingDate)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleSubscriptionAction(subscription.id, "change")}
                              className="text-blue-600 hover:text-blue-900 text-sm"
                            >
                              Change Plan
                            </button>
                            <button
                              onClick={() => handleSubscriptionAction(subscription.id, "cancel")}
                              className="text-red-600 hover:text-red-900 text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {subscriptions.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    No active subscriptions found
                  </div>
                )}
              </div>
            )}

            {/* Trials Tab */}
            {activeTab === "trials" && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Account
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Plan
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Days Remaining
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        End Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Auto-Renew
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {trials.map((trial) => (
                      <tr key={trial.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{trial.name}</div>
                            <div className="text-sm text-gray-500">{trial.email}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4">{getSubscriptionBadge(trial.subscription)}</td>
                        <td className="px-6 py-4">{getTrialStatusBadge(trial.status)}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`text-sm font-medium ${
                              trial.trialDaysRemaining <= 1
                                ? "text-red-600"
                                : trial.trialDaysRemaining <= 3
                                  ? "text-orange-600"
                                  : "text-green-600"
                            }`}
                          >
                            {trial.trialDaysRemaining} days
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {formatDate(trial.trialEndDate)}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              trial.autoRenewal
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {trial.autoRenewal ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex space-x-2">
                            {trial.status === "ACTIVE" || trial.status === "EXPIRING" ? (
                              <>
                                <button
                                  onClick={() => handleTrialAction(trial.id, "convert")}
                                  className="text-green-600 hover:text-green-900 text-sm"
                                >
                                  Convert
                                </button>
                                <button
                                  onClick={() => handleTrialAction(trial.id, "extend")}
                                  className="text-blue-600 hover:text-blue-900 text-sm"
                                >
                                  Extend
                                </button>
                                <button
                                  onClick={() => handleTrialAction(trial.id, "end")}
                                  className="text-red-600 hover:text-red-900 text-sm"
                                >
                                  End
                                </button>
                              </>
                            ) : (
                              <span className="text-gray-400 text-sm">Expired</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {trials.length === 0 && (
                  <div className="text-center py-12 text-gray-500">No trial accounts found</div>
                )}
              </div>
            )}

            {/* Billing Events Tab */}
            {activeTab === "billing" && (
              <div className="text-center py-12 text-gray-500">
                <div className="text-lg mb-2">Billing Events</div>
                <div>
                  This section will show recent billing events, payments, and transaction history.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <SubscriptionsPageContent />;
}
