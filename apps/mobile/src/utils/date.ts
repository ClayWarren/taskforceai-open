import i18n from '../i18n';
import {
  formatMessageTime as formatSharedMessageTime,
} from '@taskforceai/shared/time/display-format';

export const formatMessageTime = (timestamp: number | string | Date): string =>
  formatSharedMessageTime(timestamp, i18n.language);
