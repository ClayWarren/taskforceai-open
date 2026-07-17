'use client';

import { Button } from '@taskforceai/ui-kit/button';
import { Switch } from '@taskforceai/ui-kit/switch';

const personalizationFeatureRows = [
  [
    'Web Search',
    'Allow AI to search the web for real-time info',
    'webSearchEnabled',
    'onWebSearchToggle',
  ],
  [
    'Code Execution',
    'Allow AI to run code for complex tasks',
    'codeExecutionEnabled',
    'onCodeExecutionToggle',
  ],
  [
    'Trust Layer',
    'Enable execution reports, rubrics, and approval gates',
    'trustLayerEnabled',
    'onTrustLayerToggle',
  ],
] as const;

export function PersonalizationSection(props: {
  memoryEnabled: boolean;
  onMemoryToggle: (_enabled: boolean) => void;
  onManageMemories: () => void;
  memoryCount?: number;
  webSearchEnabled: boolean;
  onWebSearchToggle: (_enabled: boolean) => void;
  codeExecutionEnabled: boolean;
  onCodeExecutionToggle: (_enabled: boolean) => void;
  trustLayerEnabled: boolean;
  onTrustLayerToggle: (_enabled: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="memory-settings-title" className="space-y-5">
        <div className="flex items-center gap-2">
          <h4 id="memory-settings-title" className="text-lg font-semibold">
            Memory
          </h4>
          <span
            className="flex size-5 items-center justify-center rounded-full border border-border text-xs text-muted-foreground"
            title="Memory stores user-approved facts and preferences for personalization."
          >
            {/* coverage-ignore-start */}?{/* coverage-ignore-end */}
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-5">
          <div className="flex flex-col gap-1 text-left">
            <label className="text-sm font-medium">Enable memory</label>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Let TaskForceAI personalize your experience based on remembered facts and preferences.
            </p>
          </div>
          <Switch checked={props.memoryEnabled} onCheckedChange={props.onMemoryToggle} />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-5">
          <div className="flex flex-col gap-1 text-left">
            <label className="text-sm font-medium">Memory summary</label>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              View and manage what TaskForceAI has remembered about you.
            </p>
            {props.memoryCount !== undefined ? (
              <p className="text-xs text-muted-foreground">
                {props.memoryCount === 1 ? '1 saved memory' : `${props.memoryCount} saved memories`}
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={props.onManageMemories}
            className="border-white bg-white text-slate-950 hover:bg-slate-100 hover:text-slate-950"
          >
            Manage
          </Button>
        </div>
      </section>

      {personalizationFeatureRows.map(([label, description, checkedKey, onToggleKey]) => (
        <div key={label} className="flex items-center justify-between border-t border-border pt-6">
          <div className="flex flex-col gap-0.5 text-left">
            <label className="text-sm font-medium">{label}</label>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <Switch checked={props[checkedKey]} onCheckedChange={props[onToggleKey]} />
        </div>
      ))}
    </div>
  );
}
