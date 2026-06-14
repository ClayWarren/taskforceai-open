'use client';

import { Button } from '@taskforceai/ui-kit';

type ConnectedAppIntegration = {
  provider: string;
  connected: boolean;
};

const GoogleDriveIcon = () => (
  <svg viewBox="0 0 24 24" className="size-6">
    <path fill="#4285F4" d="M15.427 13.127l-2.733 4.733H4.667l2.733-4.733h8.027z" />
    <path fill="#34A853" d="M11.2 6.133l2.733 4.734H22l-2.733-4.734H11.2z" />
    <path fill="#FBBC05" d="M7.4 17.86l-2.733-4.733L2 17.86l2.733 4.733h5.4L7.4 17.86z" />
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" className="size-6">
    <path
      fill="currentColor"
      d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
    />
  </svg>
);

const CliIcon = () => (
  <div className="flex size-6 items-center justify-center rounded bg-slate-800 text-[10px] font-bold text-white">
    CLI
  </div>
);

const providerLabel = (provider: string): string => {
  if (provider === 'taskforce-cli') return 'TaskForceAI CLI';
  if (provider === 'github') return 'GitHub';
  return provider.replace('-', ' ');
};

const ProviderIcon = ({ provider }: { provider: string }) => {
  if (provider === 'google-drive') return <GoogleDriveIcon />;
  if (provider === 'github') return <GitHubIcon />;
  if (provider === 'taskforce-cli') return <CliIcon />;
  return null;
};

function ConnectedAppRow(props: {
  integration: ConnectedAppIntegration;
  onConnect: (_provider: string) => void;
  onDisconnect: (_provider: string) => void;
}) {
  const { integration } = props;

  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <ProviderIcon provider={integration.provider} />
        <div className="flex flex-col text-left">
          <span className="text-sm font-medium capitalize">
            {providerLabel(integration.provider)}
          </span>
          <span className="text-xs text-muted-foreground">
            {integration.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
      </div>

      {integration.connected ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => props.onDisconnect(integration.provider)}
        >
          Disconnect
        </Button>
      ) : integration.provider !== 'taskforce-cli' ? (
        <Button size="sm" onClick={() => props.onConnect(integration.provider)}>
          Connect
        </Button>
      ) : null}
    </div>
  );
}

export function ConnectedAppsSection(props: {
  integrations: ConnectedAppIntegration[];
  onConnect: (_provider: string) => void;
  onDisconnect: (_provider: string) => void;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Connect external services to allow TaskForceAI to access your files and data.
      </p>

      <div className="space-y-4">
        {props.integrations
          .filter(
            (integration) => integration.connected || integration.provider !== 'taskforce-cli'
          )
          .map((integration) => (
            <ConnectedAppRow
              key={integration.provider}
              integration={integration}
              onConnect={props.onConnect}
              onDisconnect={props.onDisconnect}
            />
          ))}
      </div>
    </div>
  );
}
