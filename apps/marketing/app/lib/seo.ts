export const CANONICAL_ORIGIN = 'https://www.taskforceai.chat';

const defaultImagePath = '/api/og';

type MetaEntry = Record<string, string>;
type LinkEntry = Record<string, string>;

interface PageHeadOptions {
  title: string;
  description: string;
  path: string;
  imagePath?: string;
}

const normalizeCanonicalPath = (path: string): string => {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  if (withLeadingSlash === '/') {
    return '/home';
  }
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/$/, '') : withLeadingSlash;
};

export const canonicalUrl = (path: string): string =>
  `${CANONICAL_ORIGIN}${normalizeCanonicalPath(path)}`;

const ogImageUrl = (title: string, description: string, imagePath = defaultImagePath): string => {
  if (/^https?:\/\//.test(imagePath)) {
    return imagePath;
  }

  const params = new URLSearchParams({ title, description });
  return `${CANONICAL_ORIGIN}${imagePath}?${params.toString()}`;
};

export const pageHead = ({
  title,
  description,
  path,
  imagePath,
}: PageHeadOptions): { meta: MetaEntry[]; links: LinkEntry[] } => {
  const url = canonicalUrl(path);
  const imageUrl = ogImageUrl(title, description, imagePath);

  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: url },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:image', content: imageUrl },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: imageUrl },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
};
