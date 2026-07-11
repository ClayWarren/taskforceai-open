import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { DownloadsPage } from './index';

describe('DownloadsPage', () => {
  it('renders the main heading', () => {
    render(<DownloadsPage />);
    expect(screen.getByText('Download TaskForceAI')).toBeTruthy();
    expect(screen.getByText(/Choose the version that works best for you/)).toBeTruthy();
  });

  it('renders desktop application section', () => {
    render(<DownloadsPage />);
    expect(screen.getByText('Desktop Application')).toBeTruthy();
    expect(screen.getByText(/Native apps for macOS, Windows, and Linux/)).toBeTruthy();
  });

  it('renders all three platform download cards', () => {
    render(<DownloadsPage />);
    expect(screen.getByText('macOS')).toBeTruthy();
    expect(screen.getByText('Windows')).toBeTruthy();
    expect(screen.getByText('Linux')).toBeTruthy();
  });

  it('renders macOS download options', () => {
    render(<DownloadsPage />);
    expect(screen.getAllByText('Install with Homebrew').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('link', { name: 'Download DMG (Apple Silicon)' }).getAttribute('href')
    ).toBe('https://taskforceai.chat/api/download/desktop/macos-arm64/latest');
    expect(screen.getByRole('link', { name: 'Download DMG (Intel)' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/download/desktop/macos-x64/latest'
    );
  });

  it('renders Windows download options', () => {
    render(<DownloadsPage />);
    expect(
      screen.getByRole('link', { name: 'Download Installer (x64)' }).getAttribute('href')
    ).toBe('https://taskforceai.chat/api/download/desktop/windows-x64/latest');
    expect(screen.getByRole('link', { name: 'Download MSI (x64)' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/download/desktop/windows-x64-msi/latest'
    );
    expect(
      screen.getByRole('link', { name: 'Download Installer (ARM64)' }).getAttribute('href')
    ).toBe('https://taskforceai.chat/api/download/desktop/windows-arm64/latest');
    expect(screen.getByRole('link', { name: 'Download MSI (ARM64)' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/download/desktop/windows-arm64-msi/latest'
    );
  });

  it('renders Linux download options', () => {
    render(<DownloadsPage />);
    expect(screen.getByRole('link', { name: 'Download AppImage (x64)' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/download/desktop/linux/latest'
    );
    expect(screen.getByRole('link', { name: 'Download .deb (x64)' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/download/desktop/linux-deb/latest'
    );
    expect(
      screen.getByRole('link', { name: 'Download AppImage (ARM64)' }).getAttribute('href')
    ).toBe('https://taskforceai.chat/api/download/desktop/linux-arm64/latest');
    expect(screen.getByRole('link', { name: 'Download .deb (ARM64)' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/download/desktop/linux-arm64-deb/latest'
    );
  });

  it('renders CLI section', () => {
    render(<DownloadsPage />);
    expect(screen.getByText('Command Line Interface')).toBeTruthy();
    expect(
      screen.getByText(/curl -fsSL https:\/\/taskforceai.dev\/install.sh | bash/)
    ).toBeTruthy();
  });

  it('renders mobile applications section', () => {
    render(<DownloadsPage />);
    expect(screen.getByText('Mobile Applications')).toBeTruthy();
    expect(screen.getByText(/Take TaskForceAI with you on iOS and Android/)).toBeTruthy();
    const iosAppStore = screen.getByRole('link', { name: /Download on the App Store/i });
    expect(iosAppStore.getAttribute('href')).toBe(
      'https://apps.apple.com/us/app/taskforceai/id6754827533'
    );
    expect(iosAppStore.getAttribute('target')).toBe('_blank');
    expect(iosAppStore.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('link', { name: /Join Android Beta/i }).getAttribute('href')).toBe(
      '/mobile#android-install'
    );
  });

  it('renders developer SDKs section', () => {
    render(<DownloadsPage />);
    expect(screen.getByText('Developer SDKs')).toBeTruthy();
    expect(screen.getByText('TypeScript / JavaScript')).toBeTruthy();
    expect(screen.getByText('Python')).toBeTruthy();
  });

  it('renders navigation header links', () => {
    render(<DownloadsPage />);
    // Branding in layout header
    expect(screen.getAllByText('TaskForceAI').length).toBeGreaterThan(0);
  });
});
