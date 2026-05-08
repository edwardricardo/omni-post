/**
 * @file preview.tsx
 * @description Storybook preview configuration — imports global CSS, configures controls matchers,
 *              docs table-of-contents, and default story parameters.
 * @layer infrastructure
 */
import type { Preview } from "@storybook/nextjs";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    nextjs: {
      appDirectory: true,
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: {
        contentsSelector: ".sbdocs-content",
        headingSelector: "h1, h2, h3",
        ignoreSelector: "#storybook-docs",
        title: "Table of Contents",
        disable: false,
        unsafeTocbotOptions: {
          orderedList: false,
        },
      },
    },
    viewport: {
      viewports: {
        mobile: {
          name: "Mobile",
          styles: {
            width: "375px",
            height: "667px",
          },
        },
        tablet: {
          name: "Tablet",
          styles: {
            width: "768px",
            height: "1024px",
          },
        },
        desktop: {
          name: "Desktop",
          styles: {
            width: "1440px",
            height: "900px",
          },
        },
        widescreen: {
          name: "Widescreen",
          styles: {
            width: "1920px",
            height: "1080px",
          },
        },
      },
    },
    a11y: {
      config: {
        rules: [
          {
            id: "autocomplete-valid",
            enabled: true,
          },
          {
            id: "button-name",
            enabled: true,
          },
          {
            id: "color-contrast",
            enabled: true,
          },
          {
            id: "focus-order-semantics",
            enabled: true,
          },
          {
            id: "keyboard",
            enabled: true,
          },
          {
            id: "label",
            enabled: true,
          },
          {
            id: "landmark-one-main",
            enabled: true,
          },
          {
            id: "region",
            enabled: true,
          },
        ],
      },
      options: {
        checks: { "color-contrast": { options: { noScroll: true } } },
        restoreScroll: true,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        {
          name: "light",
          value: "#ffffff",
        },
        {
          name: "dark",
          value: "#0a0a0a",
        },
        {
          name: "twitter",
          value: "#1da1f2",
        },
        {
          name: "instagram",
          value: "#e4405f",
        },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: "Global theme for components",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || "light";

      return (
        <div className={theme} data-theme={theme}>
          <div className="min-h-screen bg-background text-foreground p-4">
            <Story />
          </div>
        </div>
      );
    },
  ],
  tags: ["autodocs"],
};

export default preview;
