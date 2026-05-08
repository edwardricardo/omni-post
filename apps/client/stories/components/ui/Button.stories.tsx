/**
 * @file Button.stories.tsx
 * @description Storybook stories for the Button component showcasing variants, sizes, and
 *              icon integrations.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/nextjs";
import { action } from "storybook/actions";
import { Button } from "@packages/ui";
import { Download, Heart, Mail, Plus, Settings, Trash2, Upload } from "lucide-react";

const meta: Meta<typeof Button> = {
  title: "Components/UI/Button",
  component: Button,
  parameters: {
    docs: {
      description: {
        component: `
A flexible button component built with Radix UI Slot and class-variance-authority for consistent styling and behavior.

**Features:**
- Multiple variants (default, destructive, outline, secondary, ghost, link)
- Different sizes (sm, default, lg, icon)
- Support for icons and custom content
- Accessibility compliant with proper focus management
- Can render as different elements using the \`asChild\` prop
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive", "outline", "secondary", "ghost", "link"],
      description: "The visual style variant of the button",
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
      description: "The size of the button",
    },
    asChild: {
      control: "boolean",
      description: "Render as a different element using Radix Slot",
    },
    disabled: {
      control: "boolean",
      description: "Whether the button is disabled",
    },
    children: {
      control: "text",
      description: "Button content",
    },
  },
  args: {
    children: "Button",
    onClick: action("clicked"),
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Stories
export const Default: Story = {
  args: {
    children: "Default Button",
  },
};

export const Destructive: Story = {
  args: {
    variant: "destructive",
    children: "Delete Item",
  },
};

export const Outline: Story = {
  args: {
    variant: "outline",
    children: "Outline Button",
  },
};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Secondary Action",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "Ghost Button",
  },
};

export const Link: Story = {
  args: {
    variant: "link",
    children: "Link Button",
  },
};

// Size Variants
export const Small: Story = {
  args: {
    size: "sm",
    children: "Small Button",
  },
};

export const Large: Story = {
  args: {
    size: "lg",
    children: "Large Button",
  },
};

export const IconButton: Story = {
  args: {
    size: "icon",
    children: <Settings className="h-4 w-4" />,
  },
};

// State Stories
export const Disabled: Story = {
  args: {
    disabled: true,
    children: "Disabled Button",
  },
};

export const Loading: Story = {
  render: (args) => (
    <Button {...args} disabled>
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
      Loading...
    </Button>
  ),
};

// Icon Stories
export const WithIconLeft: Story = {
  render: (args) => (
    <Button {...args}>
      <Plus className="mr-2 h-4 w-4" />
      Add New Post
    </Button>
  ),
};

export const WithIconRight: Story = {
  render: (args) => (
    <Button {...args}>
      Download Report
      <Download className="ml-2 h-4 w-4" />
    </Button>
  ),
};

export const IconOnly: Story = {
  args: {
    size: "icon",
    variant: "outline",
    children: <Heart className="h-4 w-4" />,
  },
};

// Social Media Actions
export const SocialMediaActions: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Button>
        <Plus className="mr-2 h-4 w-4" />
        Create Post
      </Button>
      <Button variant="outline">
        <Upload className="mr-2 h-4 w-4" />
        Upload Media
      </Button>
      <Button variant="secondary">
        <Mail className="mr-2 h-4 w-4" />
        Send Draft
      </Button>
      <Button variant="destructive" size="sm">
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </Button>
      <Button variant="ghost" size="icon">
        <Settings className="h-4 w-4" />
      </Button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Common button patterns used in social media management interfaces.",
      },
    },
  },
};

// Button Groups
export const ButtonGroup: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Primary Actions</h3>
        <div className="flex gap-2">
          <Button>Publish Now</Button>
          <Button variant="outline">Schedule</Button>
          <Button variant="ghost">Save Draft</Button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Content Actions</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline">
            <Plus className="mr-1 h-3 w-3" />
            Add Media
          </Button>
          <Button size="sm" variant="outline">
            <Settings className="mr-1 h-3 w-3" />
            Settings
          </Button>
          <Button size="sm" variant="destructive">
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Navigation</h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm">
            Dashboard
          </Button>
          <Button variant="ghost" size="sm">
            Posts
          </Button>
          <Button variant="ghost" size="sm">
            Analytics
          </Button>
          <Button variant="ghost" size="sm">
            Settings
          </Button>
        </div>
      </div>
    </div>
  ),
};

// Responsive Sizes
export const ResponsiveSizes: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <Button className="w-full sm:w-auto">Full Width on Mobile</Button>
        <Button variant="outline" className="w-full sm:w-auto">
          Responsive Layout
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
        <Button size="icon">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  ),
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
  },
};

// Accessibility Story
export const AccessibilityFeatures: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-3">Keyboard Navigation</h3>
        <p className="text-sm text-muted-foreground mb-4">
          All buttons support keyboard navigation with Tab and Enter/Space keys.
        </p>
        <div className="flex gap-2">
          <Button>Tab Order 1</Button>
          <Button variant="outline">Tab Order 2</Button>
          <Button variant="secondary">Tab Order 3</Button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-3">Focus Management</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Focus rings are visible and properly styled for screen reader users.
        </p>
        <div className="flex gap-2">
          <Button className="focus-visible:ring-2 focus-visible:ring-ring">Focus Visible</Button>
          <Button variant="outline" disabled>
            Disabled State
          </Button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-3">Screen Reader Support</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Buttons include proper ARIA attributes and descriptive text.
        </p>
        <div className="flex gap-2">
          <Button aria-label="Add new social media post">
            <Plus className="mr-2 h-4 w-4" />
            Add Post
          </Button>
          <Button variant="destructive" aria-label="Delete selected posts permanently">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  ),
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "button-name", enabled: true },
          { id: "focus-order-semantics", enabled: true },
          { id: "keyboard", enabled: true },
        ],
      },
    },
  },
};

// All Variants Overview
export const AllVariants: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-medium mb-4">Button Variants</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Button>Default</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-4">Button Sizes</h3>
        <div className="flex items-center gap-4">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-4">Interactive States</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Button>Normal</Button>
          <Button className="hover:bg-primary/90">Hover</Button>
          <Button className="active:scale-95">Active</Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Complete overview of all button variants, sizes, and states available in the design system.",
      },
    },
  },
};
