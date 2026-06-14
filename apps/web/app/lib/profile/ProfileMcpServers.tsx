'use client';

import { Badge, Button, Input } from '@taskforceai/ui-kit';

export type McpServerItem = {
  name: string;
  endpoint: string;
  enabled: boolean;
};

export function McpServersSection(props: {
  servers: McpServerItem[];
  pendingName: string;
  pendingEndpoint: string;
  busyServerName: string | null;
  onPendingNameChange: (_value: string) => void;
  onPendingEndpointChange: (_value: string) => void;
  onAddServer: () => void;
  onInspectServer: (_server: McpServerItem) => void;
  onRemoveServer: (_serverName: string) => void;
}) {
  return (
    <div className="space-y-6 border-t border-border pt-6">
      <div className="space-y-2">
        <h4 className="text-sm font-medium">MCP Servers</h4>
        <p className="text-xs text-muted-foreground">
          Add remote MCP endpoints here. In the desktop app, the same flow can inspect local stdio
          servers too.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border border-border p-4">
        <Input
          value={props.pendingName}
          onChange={(event) => props.onPendingNameChange(event.target.value)}
          placeholder="Server name"
          aria-label="MCP server name"
        />
        <Input
          value={props.pendingEndpoint}
          onChange={(event) => props.onPendingEndpointChange(event.target.value)}
          placeholder="https://example.com/mcp"
          aria-label="MCP server endpoint"
        />
        <Button onClick={props.onAddServer} className="w-full sm:w-auto">
          Save MCP Server
        </Button>
      </div>

      {props.servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No MCP servers saved yet.</p>
      ) : (
        <div className="space-y-3">
          {props.servers.map((server) => (
            <div key={server.name} className="rounded-lg border border-border p-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{server.name}</span>
                  <Badge variant={server.enabled ? 'default' : 'secondary'}>
                    {server.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <code className="text-xs text-muted-foreground">{server.endpoint}</code>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => props.onInspectServer(server)}
                  disabled={props.busyServerName === server.name}
                >
                  {props.busyServerName === server.name ? 'Inspecting...' : 'Inspect'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => props.onRemoveServer(server.name)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
