import { type ComponentType } from 'react';

export type NavigationLink = { label: string; href: string };

type CTAConfig = {
  label: string;
  href: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'link' | 'light' | 'dark';
  external?: boolean;
};

export type SurfaceCardConfig = {
  name: string;
  description: string;
  primaryCta: CTAConfig;
  secondaryCta?: CTAConfig;
  accent: string;
};

export type ResourceConfig = {
  icon: ComponentType<{ className?: string }>;
  category: 'SDK' | 'REST API' | 'CLI';
  stack: string;
  slug: string;
  title: string;
  description: string;
  command?: string;
  docsHref: string;
  links?: { label: string; href: string }[];
};

export type BlogPostConfig = {
  slug: string;
  title: string;
  description: string;
  href: string;
  publishedAt: string;
  readTime: string;
  tag: string;
};
