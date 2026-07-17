import type { HelpArticle } from './types';

export const webAppArticles: HelpArticle[] = [
  {
    slug: 'getting-started-with-web-app',
    categoryId: 'web-app',
    title: 'Getting started with the web app',
    description: 'Navigate the TaskForceAI web interface.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Getting Started with the Web App\n\nThe TaskForceAI web app works in any modern browser.\n\n## Accessing the Web App\n\nVisit [taskforceai.chat/login](/login) and sign in to your account.\n\n## Interface Overview\n\n- **Sidebar**: Your conversations and settings\n- **Chat Area**: The main conversation view\n- **Input**: Where you type your messages\n- **Model Selector**: Choose or view the active model\n\n## Creating Conversations\n\n- Click "New Chat" in the sidebar\n- Or press `Cmd/Ctrl + N`\n\n## Managing Conversations\n\n- **Rename**: Right-click a conversation > Rename\n- **Delete**: Right-click a conversation > Delete\n- **Archive**: Right-click a conversation > Archive\n\n## Browser Support\n\nTaskForceAI works best in:\n\n- Chrome (recommended)\n- Firefox\n- Safari\n- Edge\n    ',
  },
  {
    slug: 'keyboard-shortcuts',
    categoryId: 'web-app',
    title: 'Keyboard shortcuts',
    description: 'Speed up your workflow with keyboard shortcuts.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Keyboard Shortcuts\n\nMaster these shortcuts to work faster in TaskForceAI.\n\n## General\n\n| Shortcut | Action |\n|----------|--------|\n| `Cmd/Ctrl + N` | New conversation |\n| `Cmd/Ctrl + K` | Search conversations |\n| `Cmd/Ctrl + ,` | Open settings |\n| `Cmd/Ctrl + /` | Show all shortcuts |\n\n## Chat\n\n| Shortcut | Action |\n|----------|--------|\n| `Enter` | Send message |\n| `Shift + Enter` | New line |\n| `Cmd/Ctrl + Enter` | Send and start new |\n| `Esc` | Cancel editing |\n\n## Navigation\n\n| Shortcut | Action |\n|----------|--------|\n| `Cmd/Ctrl + ↑` | Previous conversation |\n| `Cmd/Ctrl + ↓` | Next conversation |\n| `Cmd/Ctrl + 1-9` | Jump to conversation |\n\n## Editing\n\n| Shortcut | Action |\n|----------|--------|\n| `Cmd/Ctrl + C` | Copy selected text |\n| `Cmd/Ctrl + A` | Select all in message |\n    ',
  },
  {
    slug: 'managing-conversations',
    categoryId: 'web-app',
    title: 'Managing conversations',
    description: 'Organize, search, and manage your chat history.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Managing Conversations\n\nKeep your conversations organized and easy to find.\n\n## Conversation List\n\nYour conversations appear in the sidebar, sorted by most recent activity.\n\n## Renaming Conversations\n\nTaskForceAI auto-generates titles, but you can rename them:\n\n1. Right-click the conversation\n2. Select "Rename"\n3. Enter a new name\n4. Press Enter\n\n## Searching\n\nFind any conversation:\n\n1. Press `Cmd/Ctrl + K`\n2. Type your search query\n3. Results update in real-time\n4. Click to open a result\n\n## Archiving\n\nArchive conversations you want to keep but not see:\n\n1. Right-click the conversation\n2. Select "Archive"\n\nView archived conversations in Settings > Archived.\n\n## Deleting\n\nPermanently delete conversations:\n\n1. Right-click the conversation\n2. Select "Delete"\n3. Confirm deletion\n\n**Note**: Deleted conversations cannot be recovered.\n    ',
  },
  {
    slug: 'settings-and-preferences',
    categoryId: 'web-app',
    title: 'Settings and preferences',
    description: 'Customize your TaskForceAI experience.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Settings and Preferences\n\nCustomize TaskForceAI to work the way you want.\n\n## Accessing Settings\n\n1. Click your avatar in the top right\n2. Select "Settings"\n\n## General Settings\n\n- **Theme**: Light, dark, or system\n- **Language**: Interface language\n- **Notifications**: Email and browser notifications\n\n## Chat Settings\n\n- **Default Model**: Your preferred starting model\n- **Auto-title**: Automatically generate conversation titles\n- **Code Theme**: Syntax highlighting style\n\n## Privacy Settings\n\n- **History**: Enable or disable conversation history\n- **Analytics**: Opt in or out of usage analytics\n\n## Account Settings\n\n- **Email**: Update your email address\n- **Password**: Change your password\n- **Two-Factor**: Enable 2FA for security\n\n## Data Management\n\n- **Export**: Download all your data\n- **Delete**: Delete your account and data\n    ',
  },
];
