/**
 * @file Input.stories.tsx
 * @description Storybook stories for the Input component covering default, password, search,
 *              and icon-prefixed variants.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/nextjs";
import { action } from "storybook/actions";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Button } from "@packages/ui";
import { Eye, EyeOff, Search, Mail, Lock, DollarSign, Phone, Globe, AtSign } from "lucide-react";
import { useState } from "react";

const meta: Meta<typeof Input> = {
  title: "Components/UI/Input",
  component: Input,
  parameters: {
    docs: {
      description: {
        component: `
A flexible input component that supports various input types and styling states.

**Features:**
- Support for all HTML input types
- Consistent styling with the design system
- Focus and disabled states
- File upload styling
- Placeholder text support
- Integration with form libraries
        `,
      },
    },
  },
  argTypes: {
    type: {
      control: "select",
      options: [
        "text",
        "email",
        "password",
        "number",
        "tel",
        "url",
        "search",
        "date",
        "time",
        "datetime-local",
        "file",
      ],
      description: "The input type",
    },
    placeholder: {
      control: "text",
      description: "Placeholder text",
    },
    disabled: {
      control: "boolean",
      description: "Whether the input is disabled",
    },
    value: {
      control: "text",
      description: "Input value",
    },
  },
  args: {
    onChange: action("changed"),
    onFocus: action("focused"),
    onBlur: action("blurred"),
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Stories
export const Default: Story = {
  args: {
    placeholder: "Enter text...",
  },
};

export const WithLabel: Story = {
  render: (args) => (
    <div className="space-y-2">
      <Label htmlFor="input-with-label">Email Address</Label>
      <Input {...args} id="input-with-label" type="email" placeholder="Enter your email" />
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: "Disabled input",
  },
};

export const WithValue: Story = {
  args: {
    value: "Pre-filled value",
    placeholder: "This placeholder won't show",
  },
};

// Input Types
export const EmailInput: Story = {
  args: {
    type: "email",
    placeholder: "user@example.com",
  },
};

export const PasswordInput: Story = {
  render: function Render() {
    const [showPassword, setShowPassword] = useState(false);
    const [password, setPassword] = useState("");

    return (
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    );
  },
};

export const SearchInput: Story = {
  render: () => (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input type="search" placeholder="Search posts..." className="pl-10" />
    </div>
  ),
};

export const NumberInput: Story = {
  args: {
    type: "number",
    placeholder: "0",
    min: 0,
    max: 100,
    step: 1,
  },
};

export const DateInput: Story = {
  args: {
    type: "date",
  },
};

export const TimeInput: Story = {
  args: {
    type: "time",
  },
};

export const FileInput: Story = {
  args: {
    type: "file",
    accept: "image/*,.pdf",
  },
};

// Form Examples
export const LoginForm: Story = {
  render: () => (
    <div className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input id="login-email" type="email" placeholder="Enter your email" className="pl-10" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="login-password"
            type="password"
            placeholder="Enter your password"
            className="pl-10"
          />
        </div>
      </div>
      <Button className="w-full">Sign In</Button>
    </div>
  ),
};

export const ProfileForm: Story = {
  render: () => (
    <div className="space-y-4 max-w-md">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="first-name">First Name</Label>
          <Input id="first-name" placeholder="John" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last-name">Last Name</Label>
          <Input id="last-name" placeholder="Doe" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <div className="relative">
          <AtSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input id="username" placeholder="username" className="pl-10" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="john.doe@example.com" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input id="phone" type="tel" placeholder="+1 (555) 123-4567" className="pl-10" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="website">Website</Label>
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input id="website" type="url" placeholder="https://yourwebsite.com" className="pl-10" />
        </div>
      </div>
    </div>
  ),
};

export const SocialMediaForm: Story = {
  render: () => (
    <div className="space-y-4 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="post-title">Post Title</Label>
        <Input id="post-title" placeholder="Enter an engaging title..." />
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheduled-time">Schedule Time</Label>
        <Input id="scheduled-time" type="datetime-local" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="budget">Promotion Budget</Label>
        <div className="relative">
          <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="budget"
            type="number"
            placeholder="0.00"
            className="pl-10"
            min="0"
            step="0.01"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="media-upload">Upload Media</Label>
        <Input id="media-upload" type="file" accept="image/*,video/*" multiple />
      </div>
    </div>
  ),
};

// Validation States
export const ValidationStates: Story = {
  render: () => (
    <div className="space-y-6 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="valid-input" className="text-green-600">
          Valid Input
        </Label>
        <Input
          id="valid-input"
          value="valid@example.com"
          className="border-green-500 focus-visible:ring-green-500"
        />
        <p className="text-xs text-green-600">Email format is correct</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="invalid-input" className="text-red-600">
          Invalid Input
        </Label>
        <Input
          id="invalid-input"
          value="invalid-email"
          className="border-red-500 focus-visible:ring-red-500"
        />
        <p className="text-xs text-red-600">Please enter a valid email address</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="warning-input" className="text-yellow-600">
          Warning Input
        </Label>
        <Input
          id="warning-input"
          value="user@tempmail.com"
          className="border-yellow-500 focus-visible:ring-yellow-500"
        />
        <p className="text-xs text-yellow-600">
          Temporary email addresses may not receive notifications
        </p>
      </div>
    </div>
  ),
};

// Accessibility Features
export const AccessibilityFeatures: Story = {
  render: () => (
    <div className="space-y-6 max-w-md">
      <div>
        <h3 className="text-lg font-medium mb-4">Keyboard Navigation</h3>
        <div className="space-y-2">
          <Label htmlFor="tab-1">First Input (Tab Order 1)</Label>
          <Input id="tab-1" placeholder="Focus with Tab key" />
        </div>
        <div className="space-y-2 mt-4">
          <Label htmlFor="tab-2">Second Input (Tab Order 2)</Label>
          <Input id="tab-2" placeholder="Continues tab sequence" />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-4">Screen Reader Support</h3>
        <div className="space-y-2">
          <Label htmlFor="required-input">
            Email Address <span className="text-red-500">*</span>
          </Label>
          <Input
            id="required-input"
            type="email"
            required
            aria-required="true"
            aria-describedby="email-description"
            placeholder="Enter your email"
          />
          <p id="email-description" className="text-xs text-muted-foreground">
            This field is required and must be a valid email address
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium mb-4">Error Announcements</h3>
        <div className="space-y-2">
          <Label htmlFor="error-input">Password</Label>
          <Input
            id="error-input"
            type="password"
            aria-invalid="true"
            aria-describedby="password-error"
            className="border-red-500"
            placeholder="Enter password"
          />
          <p id="password-error" className="text-xs text-red-600" role="alert" aria-live="polite">
            Password must be at least 8 characters long
          </p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "label", enabled: true },
          { id: "keyboard", enabled: true },
          { id: "focus-order-semantics", enabled: true },
        ],
      },
    },
  },
};

// Responsive Behavior
export const ResponsiveBehavior: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="responsive-1">Full Width on Mobile</Label>
          <Input id="responsive-1" placeholder="Responsive input" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="responsive-2">Side by Side on Desktop</Label>
          <Input id="responsive-2" placeholder="Another input" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="responsive-search">Search</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="responsive-search"
            placeholder="Search across all platforms..."
            className="pl-10"
          />
        </div>
      </div>
    </div>
  ),
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
  },
};
