import type { Meta, StoryObj } from "@storybook/react";
// Simple action function for story interactions
const action =
  (name: string) =>
  (...args: any[]) => {
    console.log(`${name}:`, ...args);
  };
import { UniversalAnalyticsDashboard } from "@/components/analytics/UniversalAnalyticsDashboard";

const meta: Meta<typeof UniversalAnalyticsDashboard> = {
  title: "Admin/Analytics/UniversalAnalyticsDashboard",
  component: UniversalAnalyticsDashboard,
  parameters: {
    docs: {
      description: {
        component: `
A comprehensive analytics dashboard for cross-platform social media performance tracking.

**Features:**
- Real-time metrics across multiple social platforms
- Platform comparison and ranking
- Trend analysis with growth insights
- Custom reporting capabilities
- Export functionality (CSV/PDF)
- Performance scoring and recommendations
- Interactive time range selection
- Alert notifications for significant changes

**Use Cases:**
- Monitoring social media performance across platforms
- Identifying top-performing content and platforms
- Tracking growth trends and engagement rates
- Generating executive reports and insights
- Setting up performance alerts and notifications
        `,
      },
    },
    layout: "fullscreen",
  },
  argTypes: {
    accountId: {
      control: "text",
      description: "Account identifier for analytics",
    },
    projectId: {
      control: "text",
      description: "Project identifier for scoped analytics",
    },
    timeRange: {
      control: "select",
      options: ["7d", "30d", "90d"],
      description: "Time range for analytics data",
    },
  },
  args: {
    accountId: "acc_123456",
    projectId: "proj_789012",
    timeRange: "7d",
    onTimeRangeChange: action("time-range-change"),
    onExport: action("export"),
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-gray-50">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Stories
export const Default: Story = {
  args: {},
};

export const Weekly: Story = {
  args: {
    timeRange: "7d",
  },
  parameters: {
    docs: {
      description: {
        story: "Analytics dashboard showing data for the last 7 days with real-time updates.",
      },
    },
  },
};

export const Monthly: Story = {
  args: {
    timeRange: "30d",
  },
  parameters: {
    docs: {
      description: {
        story: "Monthly analytics view with comprehensive trend analysis and insights.",
      },
    },
  },
};

export const Quarterly: Story = {
  args: {
    timeRange: "90d",
  },
  parameters: {
    docs: {
      description: {
        story: "Quarterly analytics showing long-term performance trends.",
      },
    },
  },
};

// Interactive Stories
export const WithDataExport: Story = {
  args: {
    onExport: (format: "csv" | "pdf") => {
      action("export")(format);
      // Simulate export delay
      setTimeout(() => {
        console.log(`${format.toUpperCase()} export completed`);
      }, 2000);
    },
  },
  parameters: {
    docs: {
      description: {
        story: "Dashboard with working export functionality for CSV and PDF formats.",
      },
    },
  },
};

export const WithTimeRangeChange: Story = {
  args: {
    onTimeRangeChange: (range: string) => {
      action("time-range-change")(range);
      console.log("Time range changed to:", range);
    },
  },
  parameters: {
    docs: {
      description: {
        story: "Dashboard with time range change callback handling.",
      },
    },
  },
};

// Responsive Stories
export const MobileView: Story = {
  args: {},
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
    docs: {
      description: {
        story: "Analytics dashboard optimized for mobile devices with condensed metrics.",
      },
    },
  },
};

export const TabletView: Story = {
  args: {},
  parameters: {
    viewport: {
      defaultViewport: "tablet",
    },
    docs: {
      description: {
        story: "Tablet-optimized layout with adaptive grid systems.",
      },
    },
  },
};

// Different Account Types
export const EnterpriseAccount: Story = {
  args: {
    accountId: "enterprise_acc_456789",
    projectId: "enterprise_proj_123456",
  },
  parameters: {
    docs: {
      description: {
        story: "Analytics dashboard for enterprise account with multiple projects.",
      },
    },
  },
};

export const AgencyAccount: Story = {
  args: {
    accountId: "agency_acc_789012",
    projectId: "client_proj_345678",
  },
  parameters: {
    docs: {
      description: {
        story: "Agency dashboard managing analytics for client accounts.",
      },
    },
  },
};

// Performance Stories
export const HighVolumeData: Story = {
  args: {
    accountId: "high_volume_acc",
    projectId: "high_volume_proj",
    timeRange: "90d",
  },
  parameters: {
    docs: {
      description: {
        story: "Dashboard handling high-volume analytics data with performance optimizations.",
      },
    },
  },
};

export const LoadingState: Story = {
  render: (_args) => {
    // Force loading state by not providing data immediately
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded-sm w-1/4 mb-6"></div>
            <div className="grid grid-cols-4 gap-6 mb-8">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-gray-200 rounded-sm"></div>
              ))}
            </div>
            <div className="h-64 bg-gray-200 rounded-sm"></div>
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Loading state with skeleton UI while analytics data is being fetched.",
      },
    },
  },
};

// Error States
export const ErrorState: Story = {
  render: () => (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-lg border border-red-200 p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Analytics Unavailable</h2>
          <p className="text-gray-600 mb-6">
            We're having trouble loading your analytics data. Please try again later.
          </p>
          <div className="space-x-4">
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Retry
            </button>
            <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              Contact Support
            </button>
          </div>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Error state when analytics data cannot be loaded.",
      },
    },
  },
};

// Feature Demonstrations
export const PlatformComparison: Story = {
  render: (args) => (
    <div className="min-h-screen bg-gray-50">
      <UniversalAnalyticsDashboard {...args} />
      <div className="fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg max-w-sm">
        <h4 className="font-semibold mb-2">Platform Comparison</h4>
        <p className="text-sm opacity-90">
          Switch between metrics to compare platform performance across engagement, reach,
          impressions, and clicks.
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Demonstrates the platform comparison feature with metric switching.",
      },
    },
  },
};

export const TrendAnalysis: Story = {
  render: (args) => (
    <div className="min-h-screen bg-gray-50">
      <UniversalAnalyticsDashboard {...args} />
      <div className="fixed bottom-4 right-4 bg-green-600 text-white p-4 rounded-lg shadow-lg max-w-sm">
        <h4 className="font-semibold mb-2">Trend Analysis</h4>
        <p className="text-sm opacity-90">
          View trends tab to see growth insights, best performing times, and content
          recommendations.
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Highlights the trend analysis capabilities with growth insights.",
      },
    },
  },
};

// Accessibility Story
export const AccessibilityFeatures: Story = {
  args: {},
  render: (args) => (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 bg-blue-50 border border-blue-200 mb-6">
        <h3 className="text-lg font-semibold mb-2">Accessibility Features</h3>
        <ul className="text-sm space-y-1">
          <li>• Keyboard navigation for all interactive elements</li>
          <li>• High contrast color schemes for data visualization</li>
          <li>• Screen reader compatible metric announcements</li>
          <li>• ARIA labels for chart elements and data points</li>
          <li>• Focus management for tab navigation</li>
          <li>• Alternative text for visual elements</li>
        </ul>
      </div>
      <UniversalAnalyticsDashboard {...args} />
    </div>
  ),
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "button-name", enabled: true },
          { id: "keyboard", enabled: true },
          { id: "focus-order-semantics", enabled: true },
          { id: "color-contrast", enabled: true },
          { id: "landmark-one-main", enabled: true },
        ],
      },
    },
  },
};

// Integration Examples
export const RealTimeUpdates: Story = {
  render: (args) => {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="p-4 bg-yellow-50 border border-yellow-200 mb-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">Live Updates Active</span>
            <span className="text-xs text-gray-600">Refreshing every 30 seconds</span>
          </div>
        </div>
        <UniversalAnalyticsDashboard {...args} />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Dashboard with real-time updates and live data refresh indicators.",
      },
    },
  },
};

export const MultiProject: Story = {
  args: {
    accountId: "multi_proj_acc",
    projectId: "consolidated_view",
  },
  render: (args) => (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 bg-purple-50 border border-purple-200 mb-6">
        <h3 className="font-semibold text-purple-800">Multi-Project Analytics</h3>
        <p className="text-sm text-purple-600">
          Viewing consolidated analytics across multiple projects and campaigns.
        </p>
      </div>
      <UniversalAnalyticsDashboard {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Analytics dashboard showing consolidated data across multiple projects.",
      },
    },
  },
};
