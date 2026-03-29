# Advanced Analytics Integration

This document provides comprehensive guidance on using the advanced analytics and rule-based prediction features.

## Overview

The advanced analytics integration provides enterprise-grade analytics capabilities with predictive insights, content optimization, and comprehensive business intelligence across all social media platforms.

## Key Features

### 1. Cross-Platform Analytics Engine

- **Unified metrics** across Twitter, Instagram, Facebook, LinkedIn, YouTube, TikTok
- **Real-time data processing** with Redis caching
- **Comprehensive insights** including engagement, reach, and performance trends
- **Competitor analysis** and industry benchmarking

### 2. Rule-Based Prediction Models

- **Engagement prediction** using ensemble heuristics
- **Content optimization** with rule-based suggestions
- **Optimal timing prediction** based on audience behavior
- **Audience analysis** with heuristic segmentation

### 3. ROI Calculation & Business Intelligence

- **Multi-model cost tracking** (time-based, engagement-based, hybrid)
- **Revenue attribution** across multiple channels
- **Forecasting capabilities** with confidence intervals
- **Cost optimization recommendations**

### 4. Real-time Analytics & Alerts

- **WebSocket-based real-time updates**
- **Intelligent alerting** with customizable thresholds
- **Performance monitoring** with automated notifications
- **Dashboard streaming** for live metrics

## API Endpoints

### Cross-Platform Analytics

#### POST `/api/analytics/cross-platform`

Generate comprehensive analytics across all connected social media platforms.

**Request Body:**

```json
{
  "accountId": "account_123",
  "projectId": "project_456",
  "timeRange": "30d",
  "providers": ["twitter", "instagram"],
  "includeCompetitorAnalysis": true,
  "includePredictions": true
}
```

**Response:**

```json
{
  "ok": true,
  "analytics": {
    "summary": {
      "totalImpressions": 125000,
      "totalEngagements": 8500,
      "averageEngagementRate": 6.8,
      "totalReach": 87500,
      "totalClicks": 2100
    },
    "byProvider": [
      {
        "provider": "twitter",
        "impressions": 75000,
        "engagements": 5100,
        "engagementRate": 6.8,
        "reach": 52500,
        "clicks": 1260
      }
    ],
    "contentInsights": {
      "topPerformingPosts": [...],
      "performanceByContentType": [...],
      "hashtagAnalytics": [...],
      "optimalPostTiming": {...}
    },
    "audienceAnalytics": {
      "demographics": {...},
      "engagementPatterns": {...},
      "topSegments": [...]
    },
    "recommendations": [
      {
        "type": "content_optimization",
        "priority": "high",
        "title": "Focus on video content",
        "description": "Video content shows 45% higher engagement",
        "expectedImpact": "Increase engagement by 20-30%"
      }
    ]
  }
}
```

### ROI Calculation

#### POST `/api/analytics/roi`

Calculate return on investment with different cost and revenue models.

**Request Body:**

```json
{
  "accountId": "account_123",
  "projectId": "project_456",
  "timeRange": "30d",
  "costModel": "hybrid",
  "revenueModel": "engagement_value",
  "includeForecast": true
}
```

**Response:**

```json
{
  "ok": true,
  "roiAnalysis": {
    "totalCost": 2500.0,
    "totalRevenue": 8750.0,
    "roi": 250.0,
    "breakdown": [
      {
        "provider": "twitter",
        "cost": 1200.0,
        "revenue": 4200.0,
        "roi": 250.0
      }
    ],
    "costBreakdown": {
      "contentCreation": 1500.0,
      "advertising": 800.0,
      "toolsAndSoftware": 200.0
    },
    "revenueBreakdown": {
      "directConversions": 6000.0,
      "brandAwareness": 2750.0
    },
    "forecast": {
      "projectedROI": 280.0,
      "confidence": 0.85,
      "timeframe": "next_30_days"
    }
  }
}
```

### Performance Comparison

#### POST `/api/analytics/performance-comparison`

Compare performance across time periods, content types, platforms, or competitors.

**Request Body:**

```json
{
  "accountId": "account_123",
  "projectId": "project_456",
  "timeRange": "30d",
  "comparisonType": "time_period",
  "includeIndustryBenchmarks": true,
  "includeRecommendations": true
}
```

### Prediction Services

#### POST `/api/analytics/predict-engagement`

Predict engagement metrics for content using rule-based models.

**Request Body:**

```json
{
  "accountId": "account_123",
  "content": {
    "text": "Exciting announcement about our new product! #innovation #tech",
    "contentType": "text",
    "provider": "twitter",
    "hashtags": ["innovation", "tech"],
    "scheduledTime": "2024-02-15T14:00:00Z"
  },
  "includeOptimizations": true,
  "includeExplanation": true
}
```

**Response:**

```json
{
  "ok": true,
  "prediction": {
    "expectedImpressions": 2400,
    "expectedEngagements": 168,
    "expectedEngagementRate": 7.0,
    "expectedReach": 1680,
    "expectedClicks": 48,
    "viralPotential": 25.5,
    "confidence": 0.847,
    "factors": [
      {
        "factor": "hashtag_effectiveness",
        "impact": 0.25,
        "description": "Strong hashtag selection increases reach"
      }
    ],
    "explanation": {
      "topFactors": [...],
      "featureImportance": {...},
      "similarHistoricalCases": [...],
      "whatIfScenarios": [...]
    }
  }
}
```

#### POST `/api/analytics/optimize-content`

Get rule-based content optimization suggestions.

**Request Body:**

```json
{
  "accountId": "account_123",
  "content": {
    "text": "Our product is really good and everyone should try it",
    "contentType": "text",
    "provider": "twitter"
  },
  "optimizationGoals": ["engagement", "reach"],
  "generateVariations": true
}
```

**Response:**

```json
{
  "ok": true,
  "optimization": {
    "originalAnalysis": {
      "sentimentScore": 0.6,
      "readabilityScore": 75,
      "engagementPotential": 4.2,
      "issues": ["Generic language", "Lacks specific value proposition"]
    },
    "optimizedVersions": [
      {
        "version": 1,
        "optimizedText": "🚀 Our game-changing product delivers 3x faster results! Join 10,000+ satisfied customers. Try it free: [link] #innovation #results",
        "improvements": [
          "Added specific benefits",
          "Included social proof",
          "Added call-to-action"
        ],
        "expectedImpact": {
          "engagementIncrease": 65,
          "reachIncrease": 40
        }
      }
    ],
    "primaryRecommendations": [
      {
        "category": "content_structure",
        "suggestion": "Add specific metrics and benefits",
        "impact": "high",
        "effort": "low"
      }
    ]
  }
}
```

#### POST `/api/analytics/optimal-timing`

Get rule-based optimal posting time predictions.

**Request Body:**

```json
{
  "accountId": "account_123",
  "provider": "twitter",
  "contentType": "video",
  "timezone": "America/New_York",
  "lookbackDays": 60
}
```

#### POST `/api/analytics/audience-analysis`

Get comprehensive audience analysis and segmentation.

**Request Body:**

```json
{
  "accountId": "account_123",
  "timeRange": "90d",
  "segmentationCriteria": ["demographic", "behavioral", "engagement"],
  "includeGrowthPredictions": true,
  "includePersonalization": true
}
```

### Model Performance

#### GET `/api/analytics/models/performance`

Retrieve prediction model performance metrics and insights.

**Query Parameters:**

- `modelId` (optional): Specific model to analyze
- `timeRange`: "7d", "30d", or "90d"

## Dashboard Integration

### Enhanced Dashboard

#### GET `/api/analytics/dashboard`

Get comprehensive dashboard data with predictive insights.

**Query Parameters:**

```
projectId=project_456
timeRange=30d
includePredictions=true
includeROI=true
```

**Response includes:**

- Summary metrics across all platforms
- Trend analysis with predictions
- Content performance insights
- Audience analytics
- ROI analysis
- Performance benchmarking
- Rule-based recommendations

## Implementation Examples

### JavaScript/TypeScript Client

```typescript
import { AnalyticsClient } from "@/lib/analytics";

const analytics = new AnalyticsClient(apiKey);

// Get cross-platform analytics
const metrics = await analytics.getCrossPlatformMetrics({
  accountId: "account_123",
  timeRange: "30d",
  includePredictions: true,
});

// Predict engagement for new content
const prediction = await analytics.predictEngagement({
  content: {
    text: "New product launch announcement!",
    provider: "twitter",
    contentType: "text",
  },
});

// Optimize content
const optimization = await analytics.optimizeContent({
  content: { text: "Basic announcement" },
  optimizationGoals: ["engagement", "reach"],
});

console.log("Expected engagement:", prediction.expectedEngagements);
console.log("Optimization suggestions:", optimization.primaryRecommendations);
```

### Python Client

```python
import requests
from typing import Dict, Any

class AnalyticsClient:
    def __init__(self, api_key: str, base_url: str):
        self.api_key = api_key
        self.base_url = base_url
        self.headers = {'Authorization': f'Bearer {api_key}'}

    def get_cross_platform_metrics(self, params: Dict[str, Any]) -> Dict[str, Any]:
        response = requests.post(
            f'{self.base_url}/analytics/cross-platform',
            json=params,
            headers=self.headers
        )
        return response.json()

    def predict_engagement(self, content_data: Dict[str, Any]) -> Dict[str, Any]:
        response = requests.post(
            f'{self.base_url}/analytics/predict-engagement',
            json=content_data,
            headers=self.headers
        )
        return response.json()

# Usage
client = AnalyticsClient('your-api-key', 'https://api.your-domain.com')

metrics = client.get_cross_platform_metrics({
    'accountId': 'account_123',
    'timeRange': '30d',
    'includePredictions': True
})

print(f"Total impressions: {metrics['analytics']['summary']['totalImpressions']}")
```

## Real-time Analytics with WebSockets

### Client-side WebSocket Integration

```javascript
const socket = io("wss://api.your-domain.com", {
  auth: { token: authToken },
});

// Subscribe to analytics updates
socket.emit("subscribe_analytics", {
  projectId: "project_456",
  metrics: ["engagement_rate", "impressions", "reach"],
});

// Listen for real-time updates
socket.on("analytics_update", (data) => {
  console.log("Real-time update:", data);
  updateDashboard(data.updates);
});

// Listen for alerts
socket.on("analytics_alert", (alert) => {
  console.log("Alert triggered:", alert);
  showNotification(alert.title, alert.message);
});
```

## Caching and Performance

### Redis Caching Strategy

The analytics system uses intelligent caching to ensure high performance:

- **Query Results**: 30-minute cache for complex analytics queries
- **Predictions**: 15-minute cache for identical prediction requests
- **Real-time Metrics**: 5-minute cache for dashboard metrics
- **Model Performance**: 2-hour cache for model evaluation data

### Cache Keys Structure

```
analytics:cross_platform:{accountId}_{projectId}_{timeRange}_{hash}
ml:prediction:{contentHash}_{modelVersion}
roi:calculation:{accountId}_{projectId}_{timeRange}_{modelHash}
timing:analysis:{accountId}_{provider}_{contentType}_{lookbackDays}
```

## Error Handling

### Common Error Responses

```json
{
  "error": "Insufficient Data",
  "message": "Not enough historical data for reliable predictions",
  "code": "ANALYTICS_INSUFFICIENT_DATA",
  "details": {
    "minDataPoints": 100,
    "currentDataPoints": 45
  }
}
```

### Error Codes

- `ANALYTICS_INSUFFICIENT_DATA`: Not enough data for analysis
- `ML_MODEL_UNAVAILABLE`: Requested ML model is not available
- `RATE_LIMIT_EXCEEDED`: Too many requests in time window
- `INVALID_CONTENT_TYPE`: Unsupported content type for analysis
- `PROVIDER_NOT_CONNECTED`: Social media provider not connected

## Performance Considerations

### Rate Limits

- Cross-platform analytics: 100 requests/hour per account
- Predictions: 500 requests/hour per account
- Real-time metrics: 1000 requests/hour per account
- Data export: 10 requests/hour per account

### Optimization Tips

1. **Use caching**: Identical requests within cache TTL return cached results
2. **Batch requests**: Combine multiple analytics queries when possible
3. **Filter data**: Use provider and time range filters to reduce processing
4. **Async processing**: Use webhooks for long-running analytics jobs

## Monitoring and Observability

### Available Metrics

- Request latency and throughput
- Cache hit/miss ratios
- Prediction model accuracy and drift
- Error rates by endpoint
- Data processing pipeline health

### Health Checks

```bash
curl https://api.your-domain.com/health/analytics
curl https://api.your-domain.com/health/ml-models
```

## Security and Privacy

### Data Protection

- All analytics data is encrypted at rest and in transit
- Personal identifiable information is anonymized in analytics
- Data retention policies enforce GDPR/CCPA compliance
- Access controls ensure account-level data isolation

### Authentication

- Bearer token authentication required for all endpoints
- Account-level permissions enforced
- Rate limiting prevents abuse

## Migration Guide

### From Basic Analytics

If upgrading from basic analytics, follow these steps:

1. **Update API calls**: Replace old endpoints with new prediction-powered equivalents
2. **Handle new response formats**: Update client code to handle enhanced data structures
3. **Configure caching**: Implement client-side caching for improved performance
4. **Add error handling**: Handle new error codes and messages

### Example Migration

```typescript
// Old API call
const oldMetrics = await fetch("/api/analytics/simple-metrics");

// New API call with predictive insights
const newMetrics = await fetch("/api/analytics/cross-platform", {
  method: "POST",
  body: JSON.stringify({
    accountId: "account_123",
    timeRange: "30d",
    includePredictions: true,
  }),
});
```

## Best Practices

1. **Regular monitoring**: Check model performance metrics weekly
2. **A/B testing**: Use predictions to design effective A/B tests
3. **Iterative optimization**: Implement suggestions gradually and measure impact
4. **Data quality**: Ensure clean, consistent data for accurate predictions
5. **Feedback loops**: Report prediction accuracy to improve models

## Support and Troubleshooting

### Common Issues

**Issue**: Low prediction confidence
**Solution**: Check data quality and increase historical data timeframe

**Issue**: Slow dashboard loading
**Solution**: Reduce time range or enable caching

**Issue**: Missing provider data
**Solution**: Verify social media account connections

### Getting Help

- Documentation: `/docs/analytics`
- API Reference: `/docs/api`
- Support: `support@your-domain.com`
- Status Page: `status.your-domain.com`
