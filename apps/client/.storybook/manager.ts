/**
 * @file manager.ts
 * @description Storybook manager UI configuration for the client app — applies custom theme,
 *              panel, sidebar, and toolbar settings.
 * @layer infrastructure
 */
import { addons } from "storybook/manager-api";
import storybookTheme from "./theme";

addons.setConfig({
  theme: storybookTheme,
  panelPosition: "bottom",
  selectedPanel: "controls",
  sidebar: {
    showRoots: true,
    collapsedRoots: ["foundation"],
  },
  toolbar: {
    title: { hidden: false },
    zoom: { hidden: false },
    eject: { hidden: false },
    copy: { hidden: false },
    fullscreen: { hidden: false },
  },
});
