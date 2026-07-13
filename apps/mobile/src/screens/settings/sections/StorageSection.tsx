import React from "react";
import {
  ActivityIndicator,
  type DimensionValue,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { StorageSummary } from "@taskforceai/contracts/contracts";
import {
  formatStorageBytes,
  formatStorageItemCount,
} from "@taskforceai/presenters/storage/format";

import { Icon } from "../../../components/Icon";
import { useTheme } from "../../../contexts/ThemeContext";

interface StorageSectionProps {
  summary: StorageSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function getVisibleCategories(summary: StorageSummary) {
  const fileCategory = summary.categories.find(
    (category) => category.id === "files",
  ) ?? {
    id: "files",
    label: "Files",
    bytes: 0,
    count: 0,
  };
  const imageCategory = summary.categories.find(
    (category) => category.id === "images",
  ) ?? {
    id: "images",
    label: "Images",
    bytes: 0,
    count: 0,
  };
  return [fileCategory, imageCategory];
}

export function StorageSection({
  summary,
  loading,
  error,
  onRetry,
}: StorageSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const effectiveSummary = summary ?? {
    usedBytes: 0,
    quotaBytes: 0,
    categories: [],
  };
  const usedBytes = Math.max(0, effectiveSummary.usedBytes);
  const quotaBytes = Math.max(0, effectiveSummary.quotaBytes);
  const usagePercent =
    quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;
  const progressWidth =
    `${Math.max(usagePercent, usedBytes > 0 ? 2 : 0)}%` as DimensionValue;
  const visibleCategories = getVisibleCategories(effectiveSummary);
  const usageLabel = `${formatStorageBytes(usedBytes)} ${t(
    "mobile.settings.storage.of",
    {
      defaultValue: "of",
    },
  )} ${formatStorageBytes(quotaBytes)} ${t("mobile.settings.storage.used", {
    defaultValue: "used",
  })}`;

  if (loading && !summary) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={[styles.stateText, { color: theme.colors.textMuted }]}>
          {t("mobile.settings.storage.loading", {
            defaultValue: "Loading storage...",
          })}
        </Text>
      </View>
    );
  }

  if (error && !summary) {
    return (
      <View style={[styles.errorCard, { borderColor: theme.colors.error }]}>
        <Text style={[styles.stateText, { color: theme.colors.text }]}>
          {error}
        </Text>
        <TouchableOpacity
          onPress={onRetry}
          style={[styles.retryButton, { borderColor: theme.colors.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.retryText, { color: theme.colors.text }]}>
            {t("mobile.settings.storage.retry", { defaultValue: "Retry" })}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={[styles.usageBlock, { borderBottomColor: theme.colors.border }]}
      >
        <Text
          selectable
          style={[styles.usageText, { color: theme.colors.text }]}
        >
          {usageLabel}
        </Text>
        <View
          style={[
            styles.progressTrack,
            { backgroundColor: theme.colors.cardBackground },
          ]}
          accessibilityRole="progressbar"
          accessibilityLabel={t("mobile.settings.storage.progressLabel", {
            defaultValue: "Storage used",
          })}
          accessibilityValue={{ min: 0, max: quotaBytes, now: usedBytes }}
        >
          <View
            style={[
              styles.progressFill,
              { backgroundColor: theme.colors.text, width: progressWidth },
            ]}
          />
        </View>
        {error ? (
          <Text style={[styles.inlineError, { color: theme.colors.error }]}>
            {error}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          styles.categoryCard,
          { backgroundColor: theme.colors.cardBackground },
        ]}
      >
        {visibleCategories.map((category, index) => {
          const isLast = index === visibleCategories.length - 1;
          const categorySummary = `${formatStorageBytes(category.bytes)} - ${formatStorageItemCount(
            category.id,
            category.count,
          )}`;
          return (
            <View key={category.id}>
              <View style={styles.categoryRow}>
                <View style={styles.categoryText}>
                  <Text
                    style={[styles.categoryLabel, { color: theme.colors.text }]}
                  >
                    {category.label}
                  </Text>
                  <Text
                    selectable
                    style={[
                      styles.categoryValue,
                      { color: theme.colors.textMuted },
                    ]}
                  >
                    {categorySummary}
                  </Text>
                </View>
                <Icon
                  name="ChevronRight"
                  size={18}
                  color={theme.colors.textMuted}
                  strokeWidth={1.5}
                />
              </View>
              {!isLast ? (
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.colors.border },
                  ]}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 24,
    paddingTop: 10,
  },
  usageBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 24,
  },
  usageText: {
    fontSize: 16,
    fontWeight: "700",
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    marginTop: 12,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  categoryCard: {
    borderRadius: 14,
    overflow: "hidden",
  },
  categoryRow: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  categoryText: {
    flex: 1,
    gap: 5,
  },
  categoryLabel: {
    fontSize: 16,
    fontWeight: "600",
  },
  categoryValue: {
    fontSize: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  centerState: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 40,
  },
  stateText: {
    fontSize: 14,
  },
  errorCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  retryButton: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
  },
  inlineError: {
    fontSize: 12,
    marginTop: 10,
  },
});
