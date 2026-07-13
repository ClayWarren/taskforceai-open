import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { PluginsScreen } from '../../screens/PluginsScreen';

const mockLoadStoredMobileMcpServers = jest.fn(async () => [
  { name: 'GitHub', endpoint: 'https://github.example.com/mcp', enabled: true },
]);
const mockPersistMobileMcpServers = jest.fn(async (servers) => servers);

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#fff',
        text: '#111',
        textMuted: '#666',
        primary: '#4f8cff',
        border: '#ddd',
        inputBackground: '#f7f7f7',
        cardBackground: '#f5f5f5',
        surface: '#fff',
      },
    },
  }),
}));

jest.mock('../../mcp/store', () => ({
  loadStoredMobileMcpServers: (...args: unknown[]) => mockLoadStoredMobileMcpServers(...args),
  persistMobileMcpServers: (...args: unknown[]) => mockPersistMobileMcpServers(...args),
  subscribeMobileMcpServers: () => () => undefined,
}));

jest.mock('../../mcp/client', () => ({
  parseMobileMcpEndpoint: (endpoint: string) => ({ url: new URL(endpoint) }),
}));

describe('PluginsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows installed and featured plugins and adds an MCP endpoint', async () => {
    const view = await render(<PluginsScreen visible onClose={jest.fn()} />);

    await waitFor(() => expect(view.getByLabelText('GitHub plugin')).toBeTruthy());
    expect(view.getByText('Data Analytics')).toBeTruthy();
    expect(view.getByText('Google Drive')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('Add Data Analytics plugin'));
    await fireEvent.changeText(view.getByLabelText('Plugin endpoint'), 'https://data.example.com/mcp');
    await fireEvent.press(view.getByLabelText('Save plugin'));

    await waitFor(() =>
      expect(mockPersistMobileMcpServers).toHaveBeenCalledWith([
        { name: 'GitHub', endpoint: 'https://github.example.com/mcp', enabled: true },
        { name: 'Data Analytics', endpoint: 'https://data.example.com/mcp', enabled: true },
      ])
    );
  });

  it('filters the catalog', async () => {
    const view = await render(<PluginsScreen visible onClose={jest.fn()} />);
    await waitFor(() => expect(view.getByText('Data Analytics')).toBeTruthy());

    await fireEvent.changeText(view.getByLabelText('Search plugins'), 'drive');
    expect(view.queryByText('Data Analytics')).toBeNull();
    expect(view.getByText('Google Drive')).toBeTruthy();
  });
});
