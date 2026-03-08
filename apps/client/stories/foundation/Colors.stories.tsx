import type { Meta, StoryObj } from "@storybook/nextjs";

/**
 * # Color System
 *
 * Our color palette is built on semantic color tokens that adapt to light and dark themes.
 * All colors use HSL values with CSS custom properties for maximum flexibility.
 *
 * ## Usage Guidelines
 * - Use semantic color names (primary, secondary, destructive) instead of specific colors
 * - Colors automatically adapt to light/dark theme
 * - Maintain WCAG AA contrast ratios for accessibility
 * - Use muted variants for subtle backgrounds and borders
 */

const ColorPalette = () => {
  const colorGroups = [
    {
      title: "Primary Colors",
      description: "Main brand colors for primary actions and emphasis",
      colors: [
        {
          name: "Primary",
          value: "hsl(var(--primary))",
          textValue: "hsl(var(--primary-foreground))",
        },
        {
          name: "Primary Foreground",
          value: "hsl(var(--primary-foreground))",
          textValue: "hsl(var(--primary))",
        },
      ],
    },
    {
      title: "Secondary Colors",
      description: "Supporting colors for secondary actions and content",
      colors: [
        {
          name: "Secondary",
          value: "hsl(var(--secondary))",
          textValue: "hsl(var(--secondary-foreground))",
        },
        {
          name: "Secondary Foreground",
          value: "hsl(var(--secondary-foreground))",
          textValue: "hsl(var(--secondary))",
        },
      ],
    },
    {
      title: "Semantic Colors",
      description: "Status and feedback colors",
      colors: [
        {
          name: "Destructive",
          value: "hsl(var(--destructive))",
          textValue: "hsl(var(--destructive-foreground))",
        },
        {
          name: "Destructive Foreground",
          value: "hsl(var(--destructive-foreground))",
          textValue: "hsl(var(--destructive))",
        },
        { name: "Muted", value: "hsl(var(--muted))", textValue: "hsl(var(--muted-foreground))" },
        {
          name: "Muted Foreground",
          value: "hsl(var(--muted-foreground))",
          textValue: "hsl(var(--muted))",
        },
        { name: "Accent", value: "hsl(var(--accent))", textValue: "hsl(var(--accent-foreground))" },
        {
          name: "Accent Foreground",
          value: "hsl(var(--accent-foreground))",
          textValue: "hsl(var(--accent))",
        },
      ],
    },
    {
      title: "Base Colors",
      description: "Foundation colors for backgrounds and surfaces",
      colors: [
        {
          name: "Background",
          value: "hsl(var(--background))",
          textValue: "hsl(var(--foreground))",
        },
        {
          name: "Foreground",
          value: "hsl(var(--foreground))",
          textValue: "hsl(var(--background))",
        },
        { name: "Card", value: "hsl(var(--card))", textValue: "hsl(var(--card-foreground))" },
        {
          name: "Card Foreground",
          value: "hsl(var(--card-foreground))",
          textValue: "hsl(var(--card))",
        },
        {
          name: "Popover",
          value: "hsl(var(--popover))",
          textValue: "hsl(var(--popover-foreground))",
        },
        {
          name: "Popover Foreground",
          value: "hsl(var(--popover-foreground))",
          textValue: "hsl(var(--popover))",
        },
      ],
    },
    {
      title: "Interactive Colors",
      description: "Colors for form elements and interactions",
      colors: [
        { name: "Border", value: "hsl(var(--border))", textValue: "hsl(var(--foreground))" },
        { name: "Input", value: "hsl(var(--input))", textValue: "hsl(var(--foreground))" },
        { name: "Ring", value: "hsl(var(--ring))", textValue: "hsl(var(--background))" },
      ],
    },
    {
      title: "Social Media Brand Colors",
      description: "Platform-specific brand colors for social media integrations",
      colors: [
        { name: "Twitter Blue", value: "#1da1f2", textValue: "#ffffff" },
        { name: "Instagram Pink", value: "#e4405f", textValue: "#ffffff" },
        { name: "Facebook Blue", value: "#1877f2", textValue: "#ffffff" },
        { name: "LinkedIn Blue", value: "#0a66c2", textValue: "#ffffff" },
        { name: "TikTok Black", value: "#000000", textValue: "#ffffff" },
        { name: "YouTube Red", value: "#ff0000", textValue: "#ffffff" },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {colorGroups.map((group) => (
        <div key={group.title} className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold mb-2">{group.title}</h2>
            <p className="text-muted-foreground">{group.description}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.colors.map((color) => (
              <div key={color.name} className="rounded-lg border overflow-hidden shadow-xs">
                <div
                  className="h-24 flex items-center justify-center"
                  style={{ backgroundColor: color.value, color: color.textValue }}
                >
                  <span className="font-medium text-sm">{color.name}</span>
                </div>
                <div className="p-3 bg-card">
                  <div className="text-sm font-medium">{color.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{color.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mt-12 p-6 border rounded-lg bg-muted/50">
        <h3 className="text-lg font-semibold mb-2">Implementation Example</h3>
        <pre className="text-sm bg-background p-4 rounded-sm border overflow-x-auto">
          <code>{`// Using semantic colors in Tailwind
<button className="bg-primary text-primary-foreground hover:bg-primary/90">
  Primary Button
</button>

// Using CSS custom properties directly
.custom-element {
  background-color: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

// Social media brand colors
<div className="bg-[#1da1f2] text-white">Twitter Blue</div>`}</code>
        </pre>
      </div>
    </div>
  );
};

const meta: Meta<typeof ColorPalette> = {
  title: "Foundation/Colors",
  component: ColorPalette,
  parameters: {
    docs: {
      description: {
        component: "Complete color system with semantic tokens and social media brand colors.",
      },
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Color Palette",
  args: {},
};

export const LightTheme: Story = {
  name: "Light Theme",
  args: {},
  parameters: {
    backgrounds: { default: "light" },
  },
  decorators: [
    (Story) => (
      <div className="light">
        <Story />
      </div>
    ),
  ],
};

export const DarkTheme: Story = {
  name: "Dark Theme",
  args: {},
  parameters: {
    backgrounds: { default: "dark" },
  },
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
};
