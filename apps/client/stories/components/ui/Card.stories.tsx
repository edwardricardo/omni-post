/**
 * @file Card.stories.tsx
 * @description Storybook stories for the Card component demonstrating header/footer/content
 *              composition with avatars, badges, and action buttons.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/nextjs";
import { action } from "storybook/actions";
import {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@packages/ui";
import {
  Heart,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Calendar,
  Users,
  TrendingUp,
  Settings,
  ExternalLink,
  Star,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

const meta: Meta<typeof Card> = {
  title: "Components/UI/Card",
  component: Card,
  parameters: {
    docs: {
      description: {
        component: `
A flexible card component built with semantic HTML elements and consistent styling.

**Features:**
- Multiple layout options with header, content, and footer sections
- Semantic HTML structure for accessibility
- Consistent spacing and styling
- Support for various content types
- Responsive design patterns
- Shadow and border styling

**Components:**
- \`Card\` - Main container
- \`CardHeader\` - Header section with title and description
- \`CardTitle\` - Main heading
- \`CardDescription\` - Subtitle or description text
- \`CardContent\` - Main content area
- \`CardFooter\` - Footer section for actions or metadata
        `,
      },
    },
  },
  argTypes: {
    className: {
      control: "text",
      description: "Additional CSS classes",
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Stories
export const Default: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description or subtitle text.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>This is the main content area of the card component.</p>
      </CardContent>
      <CardFooter>
        <Button>Action</Button>
      </CardFooter>
    </Card>
  ),
};

export const SimpleCard: Story = {
  render: () => (
    <Card className="w-96 p-6">
      <h3 className="text-lg font-semibold mb-2">Simple Card</h3>
      <p className="text-muted-foreground">
        A basic card with just content, no header or footer sections.
      </p>
    </Card>
  ),
};

export const HeaderOnly: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Header Only</CardTitle>
        <CardDescription>This card only has a header section.</CardDescription>
      </CardHeader>
    </Card>
  ),
};

export const ContentOnly: Story = {
  render: () => (
    <Card className="w-96">
      <CardContent className="pt-6">
        <p>This card only contains content without header or footer.</p>
      </CardContent>
    </Card>
  ),
};

// Social Media Content Cards
export const SocialPostCard: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src="/api/placeholder/40/40" alt="User" />
            <AvatarFallback>UN</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <CardTitle className="text-base">Username</CardTitle>
              <Badge variant="secondary" className="text-xs">
                Pro
              </Badge>
            </div>
            <CardDescription className="text-xs">Posted 2 hours ago • Twitter</CardDescription>
          </div>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <p className="text-sm leading-relaxed">
          Just launched our new social media management platform! 🚀 Excited to help creators
          streamline their content workflow across multiple platforms. #SocialMedia #ProductLaunch
        </p>
      </CardContent>
      <CardFooter className="pt-3 border-t">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <Heart className="h-4 w-4 mr-1" />
              24
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <MessageCircle className="h-4 w-4 mr-1" />8
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <Share2 className="h-4 w-4 mr-1" />3
            </Button>
          </div>
          <Badge variant="outline" className="text-xs">
            <CheckCircle className="h-3 w-3 mr-1" />
            Published
          </Badge>
        </div>
      </CardFooter>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: "Social media post card with user avatar, content, and engagement metrics.",
      },
    },
  },
};

export const ScheduledPostCard: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Instagram Story</CardTitle>
            <CardDescription>Product announcement campaign</CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            Scheduled
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="space-y-3">
          <div className="aspect-video bg-linear-to-br from-purple-400 to-blue-600 rounded-md flex items-center justify-center">
            <span className="text-white font-semibold">Story Preview</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Behind the scenes of our latest product development. Swipe up to learn more!
          </p>
        </div>
      </CardContent>
      <CardFooter className="pt-3 border-t">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 mr-2" />
            Tomorrow at 2:00 PM
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm">
              Edit
            </Button>
            <Button size="sm">Publish Now</Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: "Scheduled post card with media preview and timing information.",
      },
    },
  },
};

// Analytics Cards
export const MetricsCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Total Engagement</CardTitle>
          <TrendingUp className="h-4 w-4 text-green-600" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="text-2xl font-bold">12.5K</div>
          <div className="flex items-center text-sm">
            <span className="text-green-600 font-medium">+12.3%</span>
            <span className="text-muted-foreground ml-1">from last week</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div className="bg-primary h-2 rounded-full" style={{ width: "65%" }}></div>
          </div>
        </div>
      </CardContent>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: "Analytics metrics card with trend indicators and progress visualization.",
      },
    },
  },
};

export const PlatformStatsCard: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">T</span>
          </div>
          <div>
            <CardTitle className="text-lg">Twitter</CardTitle>
            <CardDescription>@yourhandle • 2.5K followers</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-xl font-bold text-blue-600">156</div>
            <div className="text-xs text-muted-foreground">Posts</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-green-600">4.2K</div>
            <div className="text-xs text-muted-foreground">Likes</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-purple-600">892</div>
            <div className="text-xs text-muted-foreground">Retweets</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-orange-600">3.8%</div>
            <div className="text-xs text-muted-foreground">Engagement</div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full">
          View Analytics
        </Button>
      </CardFooter>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: "Platform statistics card with key metrics and analytics access.",
      },
    },
  },
};

// Settings and Configuration Cards
export const SettingsCard: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Settings className="h-5 w-5" />
          <CardTitle>Account Settings</CardTitle>
        </div>
        <CardDescription>Manage your account preferences and privacy settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Email Notifications</div>
            <div className="text-sm text-muted-foreground">Receive updates about your posts</div>
          </div>
          <input type="checkbox" className="toggle" defaultChecked />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Auto-save Drafts</div>
            <div className="text-sm text-muted-foreground">
              Automatically save content as you type
            </div>
          </div>
          <input type="checkbox" className="toggle" defaultChecked />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Dark Mode</div>
            <div className="text-sm text-muted-foreground">Use dark theme across the app</div>
          </div>
          <input type="checkbox" className="toggle" />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={action("save-settings")} className="w-full">
          Save Changes
        </Button>
      </CardFooter>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: "Settings configuration card with toggle options and save functionality.",
      },
    },
  },
};

// Team and Collaboration Cards
export const TeamMemberCard: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src="/api/placeholder/48/48" alt="Team member" />
            <AvatarFallback>SM</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <CardTitle className="text-base">Sarah Miller</CardTitle>
            <CardDescription>Content Manager</CardDescription>
          </div>
          <Badge variant="secondary">Admin</Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="space-y-2">
          <div className="flex items-center text-sm">
            <Users className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>Manages 3 projects</span>
          </div>
          <div className="flex items-center text-sm">
            <Star className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>4.9/5.0 performance rating</span>
          </div>
          <div className="flex items-center text-sm">
            <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>Last active 2 hours ago</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="pt-3 border-t">
        <div className="flex space-x-2 w-full">
          <Button variant="outline" size="sm" className="flex-1">
            Message
          </Button>
          <Button size="sm" className="flex-1">
            View Profile
          </Button>
        </div>
      </CardFooter>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: "Team member card with role information and action buttons.",
      },
    },
  },
};

// Status and Alert Cards
export const AlertCard: Story = {
  render: () => (
    <Card className="w-96 border-yellow-200">
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          <CardTitle className="text-yellow-800">Action Required</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <CardDescription className="text-yellow-700">
          Your Instagram access token will expire in 3 days. Please re-authenticate your account to
          continue posting.
        </CardDescription>
      </CardContent>
      <CardFooter>
        <div className="flex space-x-2 w-full">
          <Button variant="outline" size="sm" className="flex-1">
            Dismiss
          </Button>
          <Button size="sm" className="flex-1">
            Re-authenticate
          </Button>
        </div>
      </CardFooter>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: "Alert card with warning styling and action buttons.",
      },
    },
  },
};

// Responsive Examples
export const ResponsiveCards: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Mobile First</CardTitle>
          <CardDescription>Responsive card layout</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">This card adapts to different screen sizes.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Flexible Grid</CardTitle>
          <CardDescription>Automatic layout adjustment</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">Cards automatically reflow based on screen size.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Consistent Design</CardTitle>
          <CardDescription>Maintains spacing and proportions</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">Design system ensures consistency across breakpoints.</p>
        </CardContent>
      </Card>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Responsive card grid that adapts to different screen sizes.",
      },
    },
  },
};

// Accessibility Example
export const AccessibilityFeatures: Story = {
  render: () => (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-semibold mb-2">Accessibility Features</h3>
        <ul className="text-sm space-y-1">
          <li>• Semantic HTML structure with proper heading hierarchy</li>
          <li>• ARIA labels and descriptions for screen readers</li>
          <li>• Keyboard navigation support for interactive elements</li>
          <li>• High contrast color schemes and focus indicators</li>
          <li>• Responsive design for different device types</li>
        </ul>
      </div>

      <Card className="w-96" role="article" aria-labelledby="accessible-card-title">
        <CardHeader>
          <CardTitle id="accessible-card-title">Accessible Card Example</CardTitle>
          <CardDescription>
            This card demonstrates proper accessibility implementation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p>
            All interactive elements are keyboard accessible and properly labeled for assistive
            technologies.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            aria-label="Learn more about accessibility features"
            onClick={action("accessibility-learn-more")}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Learn More
          </Button>
        </CardFooter>
      </Card>
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

// All Variants Overview
export const AllVariants: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Basic Card</CardTitle>
          <CardDescription>Simple card with all sections</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">Standard card layout with header, content, and footer.</p>
        </CardContent>
        <CardFooter>
          <Button size="sm">Action</Button>
        </CardFooter>
      </Card>

      <Card className="border-green-200">
        <CardHeader>
          <CardTitle className="text-green-800">Success Card</CardTitle>
          <CardDescription>Styled for positive feedback</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">Cards can be styled with different border colors for context.</p>
        </CardContent>
      </Card>

      <Card className="bg-linear-to-br from-purple-50 to-blue-50">
        <CardHeader>
          <CardTitle>Gradient Card</CardTitle>
          <CardDescription>Custom background styling</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">Cards support custom backgrounds and gradients.</p>
        </CardContent>
      </Card>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Overview of different card variants and styling options.",
      },
    },
  },
};
