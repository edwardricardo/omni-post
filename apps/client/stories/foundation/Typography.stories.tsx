/**
 * @file Typography.stories.tsx
 * @description Storybook stories documenting the typography hierarchy, font weights, sizes, and
 *              line-height guidelines for the client app.
 * @layer infrastructure
 */
import type { Meta, StoryObj } from "@storybook/nextjs";

/**
 * # Typography System
 *
 * Our typography system provides a consistent hierarchy for text content across the platform.
 * Based on Tailwind CSS typography utilities with semantic sizing and spacing.
 *
 * ## Guidelines
 * - Use semantic heading levels (h1-h6) for proper document structure
 * - Maintain consistent line heights for readability
 * - Apply appropriate font weights for hierarchy
 * - Ensure sufficient contrast for accessibility
 */

const TypographySystem = () => {
  const headings = [
    {
      level: "h1",
      class: "text-4xl font-bold",
      title: "Heading 1",
      usage: "Page titles, main headings",
    },
    { level: "h2", class: "text-3xl font-semibold", title: "Heading 2", usage: "Section headings" },
    {
      level: "h3",
      class: "text-2xl font-semibold",
      title: "Heading 3",
      usage: "Subsection headings",
    },
    { level: "h4", class: "text-xl font-medium", title: "Heading 4", usage: "Component headings" },
    { level: "h5", class: "text-lg font-medium", title: "Heading 5", usage: "Card headings" },
    {
      level: "h6",
      class: "text-base font-medium",
      title: "Heading 6",
      usage: "Small component headings",
    },
  ];

  const textStyles = [
    { name: "Large Text", class: "text-lg", usage: "Prominent body text, introductions" },
    { name: "Body Text", class: "text-base", usage: "Default body text, descriptions" },
    { name: "Small Text", class: "text-sm", usage: "Secondary information, captions" },
    { name: "Extra Small", class: "text-xs", usage: "Fine print, metadata" },
  ];

  const specialStyles = [
    { name: "Lead Text", class: "text-xl text-muted-foreground", usage: "Introduction paragraphs" },
    { name: "Muted Text", class: "text-sm text-muted-foreground", usage: "Secondary information" },
    {
      name: "Code Text",
      class: "text-sm font-mono bg-muted px-1 py-0.5 rounded-sm",
      usage: "Inline code, technical text",
    },
    {
      name: "Link Text",
      class: "text-primary underline-offset-4 hover:underline",
      usage: "Clickable links",
    },
  ];

  return (
    <div className="space-y-12">
      {/* Headings */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Headings</h2>
        <div className="space-y-6">
          {headings.map((heading) => (
            <div key={heading.level} className="space-y-2">
              <div className={heading.class}>{heading.title} - The quick brown fox jumps</div>
              <div className="text-sm text-muted-foreground">
                <code className="bg-muted px-2 py-1 rounded-sm">{heading.class}</code>
                <span className="mx-2">•</span>
                {heading.usage}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Body Text */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Body Text</h2>
        <div className="space-y-6">
          {textStyles.map((style) => (
            <div key={style.name} className="space-y-2">
              <div className={style.class}>
                {style.name} - The quick brown fox jumps over the lazy dog. This is a sample text to
                demonstrate the typography style and how it appears in different contexts.
              </div>
              <div className="text-sm text-muted-foreground">
                <code className="bg-muted px-2 py-1 rounded-sm">{style.class}</code>
                <span className="mx-2">•</span>
                {style.usage}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Special Styles */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Special Styles</h2>
        <div className="space-y-6">
          {specialStyles.map((style) => (
            <div key={style.name} className="space-y-2">
              <div className={style.class}>
                {style.name === "Code Text"
                  ? 'const greeting = "Hello, World!";'
                  : style.name === "Link Text"
                    ? "This is a clickable link example"
                    : "This is an example of the typography style and how it appears in context."}
              </div>
              <div className="text-sm text-muted-foreground">
                <code className="bg-muted px-2 py-1 rounded-sm">{style.class}</code>
                <span className="mx-2">•</span>
                {style.usage}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Font Weights */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Font Weights</h2>
        <div className="space-y-4">
          <div className="text-base font-light">Light (300) - Subtle text, fine details</div>
          <div className="text-base font-normal">Normal (400) - Default body text weight</div>
          <div className="text-base font-medium">
            Medium (500) - Emphasized text, small headings
          </div>
          <div className="text-base font-semibold">
            Semibold (600) - Section headings, important text
          </div>
          <div className="text-base font-bold">Bold (700) - Main headings, strong emphasis</div>
        </div>
      </section>

      {/* Line Heights */}
      <section>
        <h2 className="text-2xl font-semibold mb-6">Line Heights</h2>
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Tight (leading-tight)</h3>
            <p className="text-base leading-tight bg-muted/30 p-4 rounded-sm">
              This paragraph demonstrates tight line height. The quick brown fox jumps over the lazy
              dog. This spacing is ideal for headings and titles where you want a more compact
              appearance.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Normal (leading-normal)</h3>
            <p className="text-base leading-normal bg-muted/30 p-4 rounded-sm">
              This paragraph demonstrates normal line height. The quick brown fox jumps over the
              lazy dog. This is the default spacing that provides good readability for most body
              text content.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Relaxed (leading-relaxed)</h3>
            <p className="text-base leading-relaxed bg-muted/30 p-4 rounded-sm">
              This paragraph demonstrates relaxed line height. The quick brown fox jumps over the
              lazy dog. This spacing provides extra breathing room and is ideal for longer form
              content and articles.
            </p>
          </div>
        </div>
      </section>

      {/* Implementation Guide */}
      <section className="p-6 border rounded-lg bg-muted/50">
        <h3 className="text-lg font-semibold mb-4">Implementation Examples</h3>
        <pre className="text-sm bg-background p-4 rounded-sm border overflow-x-auto">
          <code>{`// Semantic heading structure
<h1 className="text-4xl font-bold">Page Title</h1>
<h2 className="text-3xl font-semibold">Section Heading</h2>
<h3 className="text-2xl font-semibold">Subsection</h3>

// Body text with proper hierarchy
<p className="text-xl text-muted-foreground leading-relaxed">
  Lead paragraph with larger text and relaxed spacing
</p>
<p className="text-base leading-normal">
  Regular body text with normal spacing
</p>
<p className="text-sm text-muted-foreground">
  Secondary information in smaller text
</p>

// Special text styles
<code className="text-sm font-mono bg-muted px-1 py-0.5 rounded-sm">
  Inline code example
</code>
<a className="text-primary underline-offset-4 hover:underline">
  Link with proper styling
</a>`}</code>
        </pre>
      </section>
    </div>
  );
};

const meta: Meta<typeof TypographySystem> = {
  title: "Foundation/Typography",
  component: TypographySystem,
  parameters: {
    docs: {
      description: {
        component: "Complete typography system with semantic hierarchy and consistent spacing.",
      },
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Typography System",
  args: {},
};

export const HeadingsOnly: Story = {
  name: "Headings Hierarchy",
  render: () => (
    <div className="space-y-4">
      <h1 className="text-4xl font-bold">Heading 1 - Main Page Title</h1>
      <h2 className="text-3xl font-semibold">Heading 2 - Section Title</h2>
      <h3 className="text-2xl font-semibold">Heading 3 - Subsection</h3>
      <h4 className="text-xl font-medium">Heading 4 - Component Title</h4>
      <h5 className="text-lg font-medium">Heading 5 - Card Heading</h5>
      <h6 className="text-base font-medium">Heading 6 - Small Heading</h6>
    </div>
  ),
};

export const BodyTextExamples: Story = {
  name: "Body Text Examples",
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-2">Social Media Post Content</h3>
        <p className="text-base leading-normal">
          Creating engaging content for your social media channels requires understanding your
          audience and crafting messages that resonate with their interests and needs.
        </p>
      </div>
      <div>
        <h3 className="text-lg font-medium mb-2">Analytics Description</h3>
        <p className="text-sm text-muted-foreground">
          Track engagement metrics across all connected platforms to optimize your content strategy
          and improve reach and interaction rates.
        </p>
      </div>
      <div>
        <h3 className="text-lg font-medium mb-2">Technical Documentation</h3>
        <p className="text-base">
          Configure your API credentials by setting the{" "}
          <code className="text-sm font-mono bg-muted px-1 py-0.5 rounded-sm">OAUTH_CLIENT_ID</code>{" "}
          and visiting the{" "}
          <a href="/developer/console" className="text-primary underline-offset-4 hover:underline">
            developer console
          </a>
          .
        </p>
      </div>
    </div>
  ),
};
