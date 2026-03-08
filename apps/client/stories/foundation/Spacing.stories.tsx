import type { Meta, StoryObj } from "@storybook/nextjs";

/**
 * # Spacing System
 *
 * Our spacing system provides consistent spacing throughout the application using Tailwind's spacing scale.
 * The scale is based on rem units for accessibility and scales with user font size preferences.
 *
 * ## Guidelines
 * - Use consistent spacing for visual hierarchy
 * - Apply larger spacing for section separation
 * - Use smaller spacing for related content grouping
 * - Maintain rhythm and balance in layouts
 */

const SpacingSystem = () => {
  const spacingScale = [
    { name: "px", value: "1px", class: "w-px h-4", usage: "Borders, dividers" },
    { name: "0.5", value: "0.125rem", class: "w-0.5 h-4", usage: "Minimal spacing" },
    { name: "1", value: "0.25rem", class: "w-1 h-4", usage: "Tight spacing" },
    { name: "1.5", value: "0.375rem", class: "w-1.5 h-4", usage: "Small spacing" },
    { name: "2", value: "0.5rem", class: "w-2 h-4", usage: "Compact spacing" },
    { name: "2.5", value: "0.625rem", class: "w-2.5 h-4", usage: "Form element spacing" },
    { name: "3", value: "0.75rem", class: "w-3 h-4", usage: "Component padding" },
    { name: "3.5", value: "0.875rem", class: "w-3.5 h-4", usage: "Medium-small spacing" },
    { name: "4", value: "1rem", class: "w-4 h-4", usage: "Default spacing unit" },
    { name: "5", value: "1.25rem", class: "w-5 h-4", usage: "Card padding" },
    { name: "6", value: "1.5rem", class: "w-6 h-4", usage: "Section spacing" },
    { name: "7", value: "1.75rem", class: "w-7 h-4", usage: "Large component spacing" },
    { name: "8", value: "2rem", class: "w-8 h-4", usage: "Major section spacing" },
    { name: "9", value: "2.25rem", class: "w-9 h-4", usage: "Large padding" },
    { name: "10", value: "2.5rem", class: "w-10 h-4", usage: "Extra large spacing" },
    { name: "12", value: "3rem", class: "w-12 h-4", usage: "Section separation" },
    { name: "16", value: "4rem", class: "w-16 h-4", usage: "Page section spacing" },
    { name: "20", value: "5rem", class: "w-20 h-4", usage: "Major layout spacing" },
    { name: "24", value: "6rem", class: "w-24 h-4", usage: "Hero section spacing" },
  ];

  const layoutExamples = [
    {
      title: "Card Layout",
      description: "Typical card component spacing",
      content: (
        <div className="border rounded-lg p-6 space-y-4 bg-card">
          <h3 className="text-lg font-semibold">Card Title</h3>
          <p className="text-sm text-muted-foreground">
            Card content with proper spacing between elements. The padding provides comfortable
            reading space.
          </p>
          <div className="flex gap-2">
            <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
              Primary Action
            </button>
            <button className="px-4 py-2 border rounded-md text-sm">Secondary</button>
          </div>
        </div>
      ),
      code: `<div className="border rounded-lg p-6 space-y-4">
  <h3 className="text-lg font-semibold">Card Title</h3>
  <p className="text-sm text-muted-foreground">Card content...</p>
  <div className="flex gap-2">
    <button className="px-4 py-2 ...">Action</button>
  </div>
</div>`,
    },
    {
      title: "Form Layout",
      description: "Form elements with proper spacing",
      content: (
        <div className="space-y-6 max-w-md">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email Address</label>
            <input
              type="email"
              className="w-full px-3 py-2 border rounded-md bg-background"
              placeholder="Enter your email"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 border rounded-md bg-background"
              placeholder="Enter your password"
            />
          </div>
          <button className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md">
            Sign In
          </button>
        </div>
      ),
      code: `<div className="space-y-6">
  <div className="space-y-2">
    <label className="text-sm font-medium">Email</label>
    <input className="w-full px-3 py-2 border rounded-md" />
  </div>
  <button className="w-full px-4 py-2 ...">Submit</button>
</div>`,
    },
    {
      title: "Navigation Layout",
      description: "Navigation with consistent spacing",
      content: (
        <nav className="flex items-center justify-between p-4 border-b bg-card">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-primary rounded-sm"></div>
            <span className="font-semibold">Brand</span>
          </div>
          <div className="flex items-center space-x-6">
            <a href="#" className="text-sm hover:text-primary">
              Dashboard
            </a>
            <a href="#" className="text-sm hover:text-primary">
              Posts
            </a>
            <a href="#" className="text-sm hover:text-primary">
              Analytics
            </a>
            <button className="px-3 py-1.5 bg-primary text-primary-foreground rounded-sm text-sm">
              Upgrade
            </button>
          </div>
        </nav>
      ),
      code: `<nav className="flex items-center justify-between p-4 border-b">
  <div className="flex items-center space-x-4">
    <div className="w-8 h-8 bg-primary rounded-sm"></div>
    <span className="font-semibold">Brand</span>
  </div>
  <div className="flex items-center space-x-6">
    <a className="text-sm hover:text-primary">Dashboard</a>
    <button className="px-3 py-1.5 ...">Upgrade</button>
  </div>
</nav>`,
    },
  ];

  return (
    <div className="space-y-12">
      {/* Spacing Scale */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Spacing Scale</h2>
        <div className="space-y-4">
          {spacingScale.map((spacing) => (
            <div key={spacing.name} className="flex items-center gap-6">
              <div className="flex items-center gap-4 min-w-[200px]">
                <div className="w-12 text-right text-sm font-mono">{spacing.name}</div>
                <div className={`bg-primary ${spacing.class}`}></div>
                <div className="text-sm text-muted-foreground font-mono">{spacing.value}</div>
              </div>
              <div className="text-sm text-muted-foreground">{spacing.usage}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Common Spacing Patterns */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Common Spacing Patterns</h2>
        <div className="grid grid-cols-1 gap-8">
          <div>
            <h3 className="text-lg font-medium mb-3">Stack Spacing (space-y-*)</h3>
            <div className="border rounded-lg p-4 bg-muted/30">
              <div className="space-y-1">
                <div className="h-6 bg-primary/20 rounded-sm"></div>
                <div className="h-6 bg-primary/20 rounded-sm"></div>
                <div className="h-6 bg-primary/20 rounded-sm"></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">space-y-1 (0.25rem gap)</p>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-3">Flex Gap Spacing (gap-*)</h3>
            <div className="border rounded-lg p-4 bg-muted/30">
              <div className="flex gap-4">
                <div className="h-12 w-12 bg-primary/20 rounded-sm"></div>
                <div className="h-12 w-12 bg-primary/20 rounded-sm"></div>
                <div className="h-12 w-12 bg-primary/20 rounded-sm"></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">gap-4 (1rem gap)</p>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-3">Padding Spacing (p-*, px-*, py-*)</h3>
            <div className="border rounded-lg bg-muted/30">
              <div className="p-6 bg-primary/10 m-2 rounded-sm">
                <div className="px-4 py-2 bg-primary/20 rounded-sm">Content with padding</div>
              </div>
              <p className="text-xs text-muted-foreground p-2">Outer: p-6, Inner: px-4 py-2</p>
            </div>
          </div>
        </div>
      </section>

      {/* Layout Examples */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Layout Examples</h2>
        <div className="space-y-8">
          {layoutExamples.map((example) => (
            <div key={example.title} className="space-y-4">
              <div>
                <h3 className="text-lg font-medium">{example.title}</h3>
                <p className="text-sm text-muted-foreground">{example.description}</p>
              </div>
              <div className="border rounded-lg p-4 bg-muted/20">{example.content}</div>
              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-primary group-open:text-primary/80">
                  View Code
                </summary>
                <pre className="mt-2 text-xs bg-background p-3 rounded-sm border overflow-x-auto">
                  <code>{example.code}</code>
                </pre>
              </details>
            </div>
          ))}
        </div>
      </section>

      {/* Best Practices */}
      <section className="p-6 border rounded-lg bg-muted/50">
        <h3 className="text-lg font-semibold mb-4">Spacing Best Practices</h3>
        <div className="space-y-3 text-sm">
          <div className="flex gap-3">
            <span className="text-green-600 font-bold">✓</span>
            <span>Use consistent spacing values from the scale</span>
          </div>
          <div className="flex gap-3">
            <span className="text-green-600 font-bold">✓</span>
            <span>Apply larger spacing (8-12) for major section separation</span>
          </div>
          <div className="flex gap-3">
            <span className="text-green-600 font-bold">✓</span>
            <span>Use smaller spacing (2-4) for related content grouping</span>
          </div>
          <div className="flex gap-3">
            <span className="text-green-600 font-bold">✓</span>
            <span>Prefer space-y-* for vertical stacks, gap-* for flex layouts</span>
          </div>
          <div className="flex gap-3">
            <span className="text-red-600 font-bold">✗</span>
            <span>Don't use arbitrary values like space-y-[13px]</span>
          </div>
          <div className="flex gap-3">
            <span className="text-red-600 font-bold">✗</span>
            <span>Don't mix spacing systems (margins with space utilities)</span>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof SpacingSystem> = {
  title: "Foundation/Spacing",
  component: SpacingSystem,
  parameters: {
    docs: {
      description: {
        component: "Complete spacing system with consistent scale and layout patterns.",
      },
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Spacing System",
  args: {},
};

export const SpacingScale: Story = {
  name: "Spacing Scale Only",
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Tailwind Spacing Scale</h3>
      {[1, 2, 4, 6, 8, 12, 16, 20].map((size) => (
        <div key={size} className="flex items-center gap-4">
          <div className="w-12 text-right text-sm font-mono">{size}</div>
          <div className={`bg-primary h-4`} style={{ width: `${size * 0.25}rem` }}></div>
          <div className="text-sm text-muted-foreground">{size * 0.25}rem</div>
        </div>
      ))}
    </div>
  ),
};
