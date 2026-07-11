import type { HelpArticle } from './types';
import { gettingStartedArticles } from './getting-started';
import { accountBillingArticles } from './account-billing';
import { webAppArticles } from './web-app';
import { desktopArticles } from './desktop';
import { mobileArticles } from './mobile';
import { cliArticles } from './cli';
import { apiArticles } from './api';
import { sdksArticles } from './sdks';
import { enterpriseArticles } from './enterprise';
import { privacySecurityArticles } from './privacy-security';

export type { HelpArticle } from './types';

export const helpArticles: HelpArticle[] = [
  ...gettingStartedArticles,
  ...accountBillingArticles,
  ...webAppArticles,
  ...desktopArticles,
  ...mobileArticles,
  ...cliArticles,
  ...apiArticles,
  ...sdksArticles,
  ...enterpriseArticles,
  ...privacySecurityArticles,
];
