import type { SearchPreviewResult } from '@taskforceai/presenters/tool-usage/parsers';

import type { SourceReference, ToolUsageEvent } from '../../lib/types';

export type {
  CodeExecutionArgs,
  CodeExecutionPreview,
  SearchArgs,
} from '@taskforceai/presenters/tool-usage/parsers';

export interface ToolUsageListProps {
  events: ToolUsageEvent[];
  condensed?: boolean;
  searchInteractive?: boolean;
  onShowSources?: (sources: SourceReference[]) => void;
}

export type SearchPreviewLink = SearchPreviewResult;

export type SearchPreview = {
  domains: string[];
  links: SearchPreviewLink[];
  totalResults: number;
};
