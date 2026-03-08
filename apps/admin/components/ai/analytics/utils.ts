/**
 * @file utils.ts
 * @description Pure formatting and colour-mapping helpers shared across predictive
 * analytics components, including confidence level colours, number formatting (K/M),
 * and viral-potential badge colours.
 */

export const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 80) return "text-green-600 bg-green-100";
  if (confidence >= 60) return "text-yellow-600 bg-yellow-100";
  return "text-red-600 bg-red-100";
};

export const formatNumber = (num: number, decimals = 0): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(decimals)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(decimals)}K`;
  return num.toFixed(decimals);
};

export const getViralPotentialColor = (potential: number): string => {
  if (potential > 70) return "bg-red-100 text-red-800";
  if (potential > 40) return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-800";
};
