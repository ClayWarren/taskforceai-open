export type PluginCatalogCategory = "Featured" | "Productivity";

export type PluginCatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: PluginCatalogCategory;
  icon: string;
  tint: string;
};

export const pluginCatalog: readonly PluginCatalogEntry[] = [
  {
    id: "data-analytics",
    name: "Data Analytics",
    description: "Answer product and business questions with your data.",
    category: "Featured",
    icon: "chart",
    tint: "#8b7cf6",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Triage pull requests, issues, CI, and publish flows.",
    category: "Featured",
    icon: "github",
    tint: "#24292f",
  },
  {
    id: "investment-banking",
    name: "Investment Banking",
    description: "M&A, capital markets, LevFin, and valuation workflows.",
    category: "Featured",
    icon: "landmark",
    tint: "#3f8f65",
  },
  {
    id: "public-equity-investing",
    name: "Public Equity Investing",
    description: "Public equity research, screening, and portfolio analysis.",
    category: "Featured",
    icon: "trending-up",
    tint: "#38a169",
  },
  {
    id: "sales",
    name: "Sales",
    description: "Practical workflows for sellers and account teams.",
    category: "Productivity",
    icon: "handshake",
    tint: "#e98775",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Work across Drive, Docs, Sheets, and Slides.",
    category: "Productivity",
    icon: "cloud",
    tint: "#4285f4",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Turn notes and specs into connected workflows.",
    category: "Productivity",
    icon: "notebook",
    tint: "#303030",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Manage schedules, meetings, and follow-ups.",
    category: "Productivity",
    icon: "calendar",
    tint: "#4285f4",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Plan, triage, and ship product work.",
    category: "Productivity",
    icon: "circle-dot",
    tint: "#5e6ad2",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Access, save, and share project files.",
    category: "Productivity",
    icon: "box",
    tint: "#0061ff",
  },
] as const;
