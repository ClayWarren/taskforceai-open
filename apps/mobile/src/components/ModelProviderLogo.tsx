import { Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';

type ProviderBrand = {
  key: string;
  source: ImageSourcePropType;
};

const PROVIDER_BRANDS = {
  sentinel: { key: 'taskforceai', source: require('../../assets/icon.png') },
  openai: { key: 'openai', source: require('../../assets/provider-logos/openai.png') },
  anthropic: {
    key: 'anthropic',
    source: require('../../assets/provider-logos/anthropic.png'),
  },
  google: { key: 'google', source: require('../../assets/provider-logos/gemini.png') },
  xai: { key: 'xai', source: require('../../assets/provider-logos/xai.png') },
  meta: { key: 'meta', source: require('../../assets/provider-logos/meta.png') },
} satisfies Record<string, ProviderBrand>;

const providerBrandForModel = (modelId: string, modelLabel: string): ProviderBrand | null => {
  const normalizedId = modelId.toLowerCase();
  const normalizedLabel = modelLabel.toLowerCase();

  if (normalizedId.startsWith('zai/') || normalizedLabel === 'sentinel') {
    return PROVIDER_BRANDS.sentinel;
  }
  if (normalizedId.startsWith('openai/')) return PROVIDER_BRANDS.openai;
  if (normalizedId.startsWith('anthropic/')) return PROVIDER_BRANDS.anthropic;
  if (normalizedId.startsWith('google/')) return PROVIDER_BRANDS.google;
  if (normalizedId.startsWith('xai/')) return PROVIDER_BRANDS.xai;
  if (normalizedId.startsWith('meta/')) return PROVIDER_BRANDS.meta;

  return null;
};

export function ModelProviderLogo({ modelId, modelLabel }: { modelId: string; modelLabel: string }) {
  const brand = providerBrandForModel(modelId, modelLabel);
  if (!brand) return null;

  return (
    <View style={styles.mark} testID={`model-provider-logo-${brand.key}`}>
      <Image source={brand.source} style={styles.image} resizeMode="contain" accessible={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: 26,
    height: 26,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: 22,
    height: 22,
  },
});
