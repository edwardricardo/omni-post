import type { Meta, StoryObj } from "@storybook/nextjs";
import { action } from "storybook/actions";
import { PublishingInterface } from "@/components/publishing/PublishingInterface";
import { useState } from "react";

// Mock data for stories
const mockProviders = ["twitter", "instagram", "facebook", "linkedin"];

const sampleContent = {
  short: "Quick update on our latest feature! 🚀",
  medium:
    "Excited to announce our new social media scheduling feature! Now you can plan your content across multiple platforms with advanced threading support for Twitter and seamless media uploads. Perfect timing for your content strategy! #SocialMedia #ProductUpdate",
  long: "We're thrilled to announce a major update to our social media management platform! After months of development and user feedback, we've launched several game-changing features that will revolutionize how you manage your social presence.\n\n🚀 Advanced Scheduling: Plan your content weeks in advance with our intelligent scheduling system that considers optimal posting times for each platform.\n\n🧵 Smart Threading: Long-form content is automatically split into engaging threads for Twitter, maintaining context and readability.\n\n📱 Multi-Platform Publishing: Simultaneously publish to Twitter, Instagram, Facebook, LinkedIn, and TikTok with platform-specific optimizations.\n\n📊 Real-Time Analytics: Track engagement, reach, and performance metrics across all your connected accounts in one unified dashboard.\n\n🎯 Smart Insights: Get personalized recommendations on the best times to post and content suggestions based on your audience behavior.\n\nThis update represents our commitment to helping creators, businesses, and marketers streamline their social media workflow while maximizing their reach and engagement. We can't wait to see how you use these new tools to grow your audience and tell your story!\n\nReady to transform your social media strategy? Sign up for our free trial and experience the future of social media management today! Link in bio 👆\n\n#SocialMediaManagement #ContentCreator #DigitalMarketing #Productivity #SaaS #TechUpdate",
};

const sampleMediaFiles = [
  new File([""], "image1.jpg", { type: "image/jpeg" }),
  new File([""], "image2.png", { type: "image/png" }),
];

const meta: Meta<typeof PublishingInterface> = {
  title: "Components/Publishing/PublishingInterface",
  component: PublishingInterface,
  parameters: {
    docs: {
      description: {
        component: `
A comprehensive publishing interface for multi-platform social media content management.

**Features:**
- Multi-platform publishing with validation
- Real-time content validation and character counting
- Threading support for long-form content
- Publishing progress tracking
- Results display with success/error states
- Rate limiting awareness
- Scheduling capabilities
- Media upload support

**Use Cases:**
- Publishing content to multiple social media platforms
- Scheduling posts for optimal timing
- Managing long-form content with automatic threading
- Tracking publishing success across platforms
        `,
      },
    },
  },
  argTypes: {
    content: {
      control: "text",
      description: "The post content to be published",
    },
    selectedProviders: {
      control: "object",
      description: "Array of selected provider IDs",
    },
    scheduledDate: {
      control: "date",
      description: "Optional scheduled publication date",
    },
    mediaFiles: {
      control: "object",
      description: "Array of media files to be attached",
    },
  },
  args: {
    onPublishSuccess: action("publish-success"),
    onPublishError: action("publish-error"),
  },
  decorators: [
    (Story) => (
      <div className="max-w-4xl mx-auto p-6">
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
  args: {
    content: sampleContent.medium,
    mediaFiles: [],
    selectedProviders: ["twitter", "instagram"],
  },
};

export const ShortContent: Story = {
  args: {
    content: sampleContent.short,
    mediaFiles: [],
    selectedProviders: ["twitter", "instagram", "facebook"],
  },
  parameters: {
    docs: {
      description: {
        story: "Publishing interface with short content that fits within all platform limits.",
      },
    },
  },
};

export const LongContentWithThreading: Story = {
  args: {
    content: sampleContent.long,
    mediaFiles: [],
    selectedProviders: ["twitter", "linkedin"],
  },
  parameters: {
    docs: {
      description: {
        story: "Long-form content that will be automatically split into threads for Twitter.",
      },
    },
  },
};

export const WithMediaFiles: Story = {
  args: {
    content: sampleContent.medium,
    mediaFiles: sampleMediaFiles,
    selectedProviders: ["instagram", "facebook", "twitter"],
  },
  parameters: {
    docs: {
      description: {
        story: "Publishing interface with media files attached.",
      },
    },
  },
};

export const ScheduledPost: Story = {
  args: {
    content: sampleContent.medium,
    mediaFiles: [],
    selectedProviders: ["twitter", "linkedin"],
    scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
  },
  parameters: {
    docs: {
      description: {
        story: "Interface configured for scheduling a post for future publication.",
      },
    },
  },
};

export const AllPlatforms: Story = {
  args: {
    content: sampleContent.medium,
    mediaFiles: sampleMediaFiles.slice(0, 1),
    selectedProviders: mockProviders,
  },
  parameters: {
    docs: {
      description: {
        story: "Publishing to all available platforms with comprehensive overview.",
      },
    },
  },
};

// Interactive Stories
export const InteractivePublishing: Story = {
  render: function Render() {
    const [content, setContent] = useState(sampleContent.medium);
    const [selectedProviders, setSelectedProviders] = useState(["twitter", "instagram"]);
    const [mediaFiles, setMediaFiles] = useState<File[]>([]);
    const [scheduledDate, setScheduledDate] = useState<Date | undefined>();

    const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
    };

    const handleProviderToggle = (providerId: string) => {
      setSelectedProviders((prev) =>
        prev.includes(providerId) ? prev.filter((id) => id !== providerId) : [...prev, providerId]
      );
    };

    const handleMediaAdd = () => {
      const newFile = new File([""], `image${mediaFiles.length + 1}.jpg`, { type: "image/jpeg" });
      setMediaFiles((prev) => [...prev, newFile]);
    };

    const handleScheduleToggle = () => {
      setScheduledDate((prev) => (prev ? undefined : new Date(Date.now() + 24 * 60 * 60 * 1000)));
    };

    return (
      <div className="space-y-6">
        {/* Content Editor */}
        <div className="space-y-4 p-4 border rounded-lg bg-card">
          <h3 className="text-lg font-semibold">Content</h3>
          <textarea
            value={content}
            onChange={handleContentChange}
            className="w-full min-h-[120px] p-3 border rounded-md resize-none"
            placeholder="What do you want to share?"
          />
          <div className="text-sm text-muted-foreground">{content.length} characters</div>
        </div>

        {/* Platform Selection */}
        <div className="space-y-4 p-4 border rounded-lg bg-card">
          <h3 className="text-lg font-semibold">Platforms</h3>
          <div className="flex flex-wrap gap-2">
            {mockProviders.map((provider) => (
              <button
                key={provider}
                onClick={() => handleProviderToggle(provider)}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  selectedProviders.includes(provider)
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {provider}
              </button>
            ))}
          </div>
        </div>

        {/* Media and Scheduling */}
        <div className="space-y-4 p-4 border rounded-lg bg-card">
          <h3 className="text-lg font-semibold">Options</h3>
          <div className="flex gap-4">
            <button
              onClick={handleMediaAdd}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            >
              Add Media ({mediaFiles.length})
            </button>
            <button
              onClick={handleScheduleToggle}
              className={`px-4 py-2 rounded-md ${
                scheduledDate
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {scheduledDate ? "Scheduled" : "Schedule"}
            </button>
          </div>
        </div>

        {/* Publishing Interface */}
        <PublishingInterface
          content={content}
          mediaFiles={mediaFiles}
          selectedProviders={selectedProviders}
          {...(scheduledDate && { scheduledDate })}
          onPublishSuccess={action("publish-success")}
          onPublishError={action("publish-error")}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Interactive demo where you can modify content, select platforms, and see real-time validation.",
      },
    },
  },
};

// State Stories
export const ValidationErrors: Story = {
  args: {
    content:
      sampleContent.long +
      " ".repeat(1000) +
      "This content is way too long and will exceed all platform limits causing validation errors.",
    mediaFiles: Array.from(
      { length: 6 },
      (_, i) => new File([""], `image${i + 1}.jpg`, { type: "image/jpeg" })
    ),
    selectedProviders: mockProviders,
  },
  parameters: {
    docs: {
      description: {
        story: "Interface showing validation errors for content that exceeds platform limits.",
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    content: "",
    mediaFiles: [],
    selectedProviders: [],
  },
  parameters: {
    docs: {
      description: {
        story: "Empty state when no content or platforms are selected.",
      },
    },
  },
};

export const SinglePlatform: Story = {
  args: {
    content: sampleContent.short,
    mediaFiles: [],
    selectedProviders: ["twitter"],
  },
  parameters: {
    docs: {
      description: {
        story: "Publishing to a single platform with simplified interface.",
      },
    },
  },
};

// Responsive Stories
export const MobileView: Story = {
  args: {
    content: sampleContent.medium,
    mediaFiles: sampleMediaFiles.slice(0, 1),
    selectedProviders: ["twitter", "instagram"],
  },
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
    docs: {
      description: {
        story: "Publishing interface optimized for mobile devices.",
      },
    },
  },
};

export const TabletView: Story = {
  args: {
    content: sampleContent.medium,
    mediaFiles: sampleMediaFiles,
    selectedProviders: mockProviders,
  },
  parameters: {
    viewport: {
      defaultViewport: "tablet",
    },
    docs: {
      description: {
        story: "Publishing interface on tablet-sized screens.",
      },
    },
  },
};

// Accessibility Story
export const AccessibilityFeatures: Story = {
  args: {
    content: sampleContent.medium,
    mediaFiles: [],
    selectedProviders: ["twitter", "instagram"],
  },
  render: (args) => (
    <div>
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">Accessibility Features</h3>
        <ul className="text-sm space-y-1">
          <li>• Keyboard navigation support for all interactive elements</li>
          <li>• Screen reader announcements for publishing progress</li>
          <li>• High contrast error and success states</li>
          <li>• Descriptive ARIA labels and live regions</li>
          <li>• Focus management during publishing process</li>
        </ul>
      </div>
      <PublishingInterface
        content={args.content}
        mediaFiles={args.mediaFiles}
        selectedProviders={args.selectedProviders}
        {...(args.scheduledDate && { scheduledDate: args.scheduledDate })}
        {...(args.postId && { postId: args.postId })}
        onPublishSuccess={action("publish-success")}
        onPublishError={action("publish-error")}
      />
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
        ],
      },
    },
  },
};

// Performance Story
export const PerformanceDemo: Story = {
  args: {
    content: sampleContent.long,
    mediaFiles: Array.from(
      { length: 4 },
      (_, i) => new File([""], `image${i + 1}.jpg`, { type: "image/jpeg" })
    ),
    selectedProviders: mockProviders,
  },
  render: (args) => (
    <div>
      <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">Performance Optimizations</h3>
        <ul className="text-sm space-y-1">
          <li>• Real-time validation with debounced content analysis</li>
          <li>• Memoized calculations for publishing stats</li>
          <li>• Progressive publishing with individual platform feedback</li>
          <li>• Efficient re-rendering with React optimization patterns</li>
        </ul>
      </div>
      <PublishingInterface
        content={args.content}
        mediaFiles={args.mediaFiles}
        selectedProviders={args.selectedProviders}
        {...(args.scheduledDate && { scheduledDate: args.scheduledDate })}
        {...(args.postId && { postId: args.postId })}
        onPublishSuccess={action("publish-success")}
        onPublishError={action("publish-error")}
      />
    </div>
  ),
};
