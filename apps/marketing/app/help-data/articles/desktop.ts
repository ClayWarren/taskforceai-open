import type { HelpArticle } from './types';

export const desktopArticles: HelpArticle[] = [
  {
    slug: 'installing-on-mac',
    categoryId: 'desktop',
    title: 'Installing on Mac',
    description: 'Download and install TaskForceAI for macOS.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Installing on Mac\n\nGet TaskForceAI running on your Mac in minutes.\n\n## System Requirements\n\n- macOS 12.0 (Monterey) or later\n- Apple Silicon (M1/M2/M3) or Intel processor\n- 500MB disk space\n\n## Installation Methods\n\n### Direct Download\n\n1. Visit [taskforceai.chat/downloads](/downloads)\n2. Click "Download for Mac"\n3. Open the downloaded .dmg file\n4. Drag TaskForceAI to Applications\n5. Launch from Applications\n\n### Homebrew\n\n```bash\nbrew install --cask taskforceai\n```\n\n## First Launch\n\nOn first launch, macOS may show a security prompt:\n\n1. Click "Open" to allow\n2. Sign in with your TaskForceAI account\n3. Grant accessibility permissions if prompted\n\n## Keeping Updated\n\nTaskForceAI updates automatically. You can also check for updates manually:\n\n1. Open TaskForceAI\n2. Click TaskForceAI > Check for Updates\n    ',
  },
  {
    slug: 'installing-on-windows',
    categoryId: 'desktop',
    title: 'Installing on Windows',
    description: 'Download and install TaskForceAI for Windows.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Installing on Windows\n\nGet TaskForceAI running on your Windows PC.\n\n## System Requirements\n\n- Windows 10 (version 1903) or later\n- 64-bit processor\n- 500MB disk space\n\n## Installation\n\n1. Visit [taskforceai.chat/downloads](/downloads)\n2. Click "Download for Windows"\n3. Run the downloaded installer\n4. Follow the installation wizard\n5. Launch TaskForceAI from Start menu\n\n## Installation Options\n\nDuring installation, you can choose:\n\n- Install location\n- Desktop shortcut\n- Start menu entry\n- Launch on startup\n\n## First Launch\n\n1. Open TaskForceAI\n2. Sign in with your account\n3. Allow through Windows Firewall if prompted\n\n## Keeping Updated\n\nTaskForceAI updates automatically. Manual check:\n\n1. Open TaskForceAI\n2. Click Help > Check for Updates\n    ',
  },
  {
    slug: 'installing-on-linux',
    categoryId: 'desktop',
    title: 'Installing on Linux',
    description: 'Download and install TaskForceAI for Linux.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Installing on Linux\n\nGet TaskForceAI running on your Linux distribution.\n\n## System Requirements\n\n- Ubuntu 20.04+, Fedora 35+, or Debian 11+\n- 64-bit processor\n- 500MB disk space\n\n## Installation Methods\n\n### AppImage (Universal)\n\n```bash\n# Download from taskforceai.chat/downloads\nchmod +x TaskForceAI.AppImage\n./TaskForceAI.AppImage\n```\n\n### Debian/Ubuntu (.deb)\n\n```bash\n# Download the .deb package\nsudo dpkg -i taskforceai.deb\n```\n\n### Fedora/RHEL (.rpm)\n\n```bash\n# Download the .rpm package\nsudo rpm -i taskforceai.rpm\n```\n\n## First Launch\n\n1. Launch TaskForceAI from your application menu\n2. Sign in with your account\n3. Grant any required permissions\n\n## Troubleshooting\n\nIf you encounter issues:\n\n- Ensure all dependencies are installed\n- Check the terminal for error messages\n- Visit our [status page](https://status.taskforceai.chat) for known issues\n    ',
  },
  {
    slug: 'updating-the-desktop-app',
    categoryId: 'desktop',
    title: 'Updating the desktop app',
    description: 'Keep your desktop app up to date.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Updating the Desktop App\n\nTaskForceAI automatically checks for and installs updates.\n\n## Automatic Updates\n\nBy default, TaskForceAI:\n\n1. Checks for updates on launch\n2. Downloads updates in the background\n3. Prompts you to restart when ready\n\n## Manual Update Check\n\nTo check manually:\n\n- **Mac**: TaskForceAI > Check for Updates\n- **Windows**: Help > Check for Updates\n- **Linux**: Help > Check for Updates\n\n## Update Settings\n\nConfigure update behavior:\n\n1. Open Settings\n2. Go to "General"\n3. Find "Updates" section\n\nOptions:\n- Automatic updates (recommended)\n- Notify only\n- Manual only\n\n## Troubleshooting Updates\n\nIf updates fail:\n\n1. Check your internet connection\n2. Restart the app\n3. Re-download from [downloads](/downloads) if needed\n    ',
  },
  {
    slug: 'troubleshooting-common-issues',
    categoryId: 'desktop',
    title: 'Troubleshooting common issues',
    description: 'Fix common desktop app problems.',
    lastUpdated: '2025-01-15',
    content:
      "\n# Troubleshooting Common Issues\n\nSolutions for common desktop app problems.\n\n## App Won't Launch\n\n1. **Restart your computer**\n2. **Check system requirements**\n3. **Re-install the app**\n\n## Connection Issues\n\nIf you can't connect:\n\n1. Check your internet connection\n2. Check [status.taskforceai.chat](https://status.taskforceai.chat)\n3. Disable VPN temporarily\n4. Check firewall settings\n\n## Slow Performance\n\nTo improve performance:\n\n1. Close unused conversations\n2. Clear cache in Settings\n3. Restart the app\n4. Update to latest version\n\n## Keyboard Shortcuts Not Working\n\n1. Check for conflicts with system shortcuts\n2. Reset shortcuts in Settings\n3. Grant accessibility permissions (Mac)\n\n## High CPU/Memory Usage\n\n1. Limit open conversations\n2. Disable animations in Settings\n3. Restart the app\n\n## Getting More Help\n\nIf issues persist:\n\n1. Check our [status page](https://status.taskforceai.chat)\n2. Contact [support@taskforceai.chat](mailto:support@taskforceai.chat)\n    ",
  },
];
