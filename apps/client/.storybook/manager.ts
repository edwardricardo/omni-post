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
