import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

/**
 * Chrome Manifest V3.
 *
 * Permissions are deliberately minimal:
 *  - activeTab: access to the current tab only after the user clicks the extension.
 *  - scripting: inject the content script into that tab on demand.
 *  - storage: settings, anonymous client id, local history.
 * No host_permissions: DOUALA AI never gets blanket access to all websites.
 */
export default defineManifest({
  manifest_version: 3,
  name: "DOUALA AI",
  short_name: "Douala AI",
  description: "Translate website interfaces from English or French into Douala, grounded in real linguistic resources.",
  version: pkg.version,
  minimum_chrome_version: "116",
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_title: "DOUALA AI — translate this page into Douala",
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["activeTab", "scripting", "storage"],
});
