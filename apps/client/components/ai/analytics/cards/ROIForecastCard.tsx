/**
 * @file ROIForecastCard.tsx
 * @description Card rendering projected return-on-investment figures for a social
 * media campaign, covering estimated revenue, cost breakdown, and net ROI percentage.
 */

import React from "react";
import { DollarSign } from "lucide-react";
import { ROIForecast } from "../types";
import { formatNumber } from "../utils";

interface ROIForecastCardProps {
  forecast: ROIForecast;
}

/**
 * @component ROIForecastCard
 * @description Card rendering projected return-on-investment figures for a campaign,
 * covering estimated revenue, cost breakdown, and net ROI percentage.
 */
export const ROIForecastCard: React.FC<ROIForecastCardProps> = ({ forecast }) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-linear-to-br from-green-50 to-emerald-100 rounded-lg p-6">
          <div className="flex items-center space-x-3 mb-4">
            <DollarSign className="w-8 h-8 text-green-600" />
            <div>
              <h4 className="text-lg font-semibold text-gray-900">ROI Forecast</h4>
              <p className="text-sm text-gray-600">{forecast.timeframe} prediction</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-3xl font-bold text-green-700">
              {forecast.expectedROI.toFixed(1)}x
            </div>
            <div className="text-sm text-green-600">
              {Math.round(forecast.confidence)}% confidence
            </div>
            <div className="text-sm text-gray-700">
              Expected return: ${formatNumber(forecast.breakdown.revenue)} from $
              {formatNumber(forecast.breakdown.cost)} investment
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-lg p-6">
          <h5 className="font-semibold text-gray-900 mb-4">Revenue Breakdown</h5>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Organic Reach:</span>
              <span className="font-medium">{formatNumber(forecast.breakdown.organicReach)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Paid Reach:</span>
              <span className="font-medium">{formatNumber(forecast.breakdown.paidReach)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Conversions:</span>
              <span className="font-medium">{Math.round(forecast.breakdown.conversions)}</span>
            </div>
            <div className="border-t pt-3 flex justify-between">
              <span className="text-gray-900 font-semibold">Total Revenue:</span>
              <span className="font-bold text-green-600">
                ${formatNumber(forecast.breakdown.revenue)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-6">
        <h5 className="font-semibold text-gray-900 mb-4">Impact Factors</h5>
        <div className="space-y-4">
          {forecast.factors.map((factor, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <div className="flex-1">
                <div className="font-medium text-gray-900">{factor.name}</div>
                <div className="text-sm text-gray-600">{factor.description}</div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-24 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full"
                    style={{ width: `${factor.impact}%` }}
                  ></div>
                </div>
                <span className="text-sm font-medium w-12">{Math.round(factor.impact)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
