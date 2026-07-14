export type I18nResource = Record<string, unknown>;

export interface I18nLike {
  isInitialized: boolean;
  use?: (plugin: unknown) => I18nLike;
  init: (options: I18nInitOptions) => unknown;
}

export interface I18nInitOptions {
  resources: I18nResource;
  lng: string;
  fallbackLng: string;
  debug: boolean;
  interpolation: {
    escapeValue: boolean;
  };
  detection: {
    order: string[];
    caches: string[];
  };
  react: {
    useSuspense: boolean;
  };
}

export interface I18nConfigOptions {
  resources: I18nResource;
  lng?: string;
  fallbackLng?: string;
  debug?: boolean;
  plugins?: readonly unknown[];
  locizeLastUsed?: boolean;
  interpolation?: {
    escapeValue?: boolean;
  };
  detection?: {
    order?: string[];
    caches?: string[];
  };
}

export const initializeI18n = (i18nInstance: I18nLike, options: I18nConfigOptions) => {
  if (i18nInstance.isInitialized) return;

  for (const plugin of options.plugins ?? []) {
    i18nInstance.use?.(plugin);
  }

  void i18nInstance.init({
    resources: options.resources,
    lng: options.lng || 'en',
    fallbackLng: options.fallbackLng || 'en',
    debug: options.debug || false,
    interpolation: {
      escapeValue: options.interpolation?.escapeValue ?? false,
    },
    detection: {
      order: options.detection?.order ?? [],
      caches: options.detection?.caches ?? [],
    },
    react: {
      useSuspense: false,
    },
  });
};
