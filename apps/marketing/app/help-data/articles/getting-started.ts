import type { HelpArticle } from './types';

export const gettingStartedArticles: HelpArticle[] = [
  {
    slug: 'what-is-taskforceai',
    categoryId: 'getting-started',
    title: 'What is TaskForceAI?',
    description: 'Learn about TaskForceAI and multi-agent AI orchestration.',
    lastUpdated: '2025-01-15',
    content:
      '\n# What is TaskForceAI?\n\nTaskForceAI is a multi-agent AI orchestration platform that intelligently routes your requests to the best AI models for each task. Instead of relying on a single model, TaskForceAI combines the strengths of multiple specialized AI agents — powered by our core intelligence layer, **Sentinel** — to deliver superior results.\n\n## Key Features\n\n- **Sentinel Intelligence**: Our flagship high-reasoning model for complex planning and synthesis\n- **Multi-Agent Orchestration**: Automatically selects and combines the best AI models for your task\n- **Universal Access**: Available on web, desktop (Mac, Windows, Linux), mobile (iOS, Android), CLI, and API\n- **Enterprise Ready**: SSO, SCIM, audit logs, and zero-retention options\n- **Developer Tools**: SDKs for TypeScript, Python, Rust, and Go\n\n## How It Works\n\nWhen you send a request to TaskForceAI:\n\n1. Our routing system analyzes your request\n2. It selects the optimal model(s) for the task\n3. The response is generated and returned to you\n4. For complex tasks, multiple models may collaborate\n\n## Getting Started\n\nReady to start? [Create your account](/login) or explore our [documentation](https://docs.taskforceai.chat/docs).\n    ',
  },
  {
    slug: 'creating-your-account',
    categoryId: 'getting-started',
    title: 'Creating your account',
    description: 'Sign up for TaskForceAI and start your first session.',
    lastUpdated: '2026-07-11',
    content:
      '\n# Creating Your Account\n\nGetting started with TaskForceAI takes less than a minute.\n\n## Sign Up Steps\n\n1. Visit [taskforceai.chat/login](/login)\n2. Choose **Sign in with WorkOS**\n3. Complete the hosted sign-in and email verification steps\n4. Return to TaskForceAI\n\n## Account Types\n\n- **Free**: Limited usage, great for trying TaskForceAI\n- **Pro**: Higher usage limits and priority access\n- **Super**: Our highest individual usage tier\n- **Enterprise**: Organization features including SSO and SCIM\n\n## Next Steps\n\nAfter creating your account:\n\n- Complete your profile settings\n- Start your [first conversation](/help/getting-started/your-first-conversation)\n- Explore [keyboard shortcuts](/help/web-app/keyboard-shortcuts)\n    ',
  },
  {
    slug: 'your-first-conversation',
    categoryId: 'getting-started',
    title: 'Your first conversation',
    description: 'Start chatting with TaskForceAI.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Your First Conversation\n\nReady to chat? Here\'s how to get the most out of TaskForceAI.\n\n## Starting a Conversation\n\n1. Log in to TaskForceAI\n2. Click "New Chat" or press `Cmd/Ctrl + N`\n3. Type your message and press Enter\n\n## Tips for Better Results\n\n- **Be specific**: The more context you provide, the better the response\n- **Use follow-ups**: Continue the conversation to refine results\n- **Try different approaches**: If one phrasing doesn\'t work, try another\n\n## Example Prompts\n\n- "Explain quantum computing in simple terms"\n- "Help me write a Python function to sort a list"\n- "What are the pros and cons of React vs Vue?"\n\n## Understanding Responses\n\nTaskForceAI may use different models for different parts of your request. You\'ll see indicators showing which models contributed to your response.\n    ',
  },
  {
    slug: 'understanding-multi-agent-orchestration',
    categoryId: 'getting-started',
    title: 'Understanding multi-agent orchestration',
    description: 'Learn how TaskForceAI combines multiple AI models.',
    lastUpdated: '2025-01-15',
    content:
      "\n# Understanding Multi-Agent Orchestration\n\nTaskForceAI's core innovation is intelligent multi-agent orchestration. Here's what that means.\n\n## The Problem with Single Models\n\nEvery AI model has strengths and weaknesses:\n\n- Some excel at coding tasks\n- Others are better at creative writing\n- Some specialize in reasoning and analysis\n- Others are optimized for speed\n\n## Our Solution\n\nTaskForceAI analyzes each request and routes it to the best model(s) for the job. Our flagship model, **Sentinel**, acts as the primary reasoning layer that coordinates specialized agents to solve complex problems. For high-intensity tasks, multiple models may work together.\n\n## How Routing Works\n\n1. **Analysis**: Your request is analyzed for intent and complexity\n2. **Selection**: The optimal model(s) are selected\n3. **Execution**: The request is processed\n4. **Synthesis**: Results are combined if multiple models contributed\n\n## Benefits\n\n- Better results for specialized tasks\n- Faster responses when appropriate\n- Cost efficiency through intelligent routing\n- Access to frontier models when needed\n    ",
  },
  {
    slug: 'choosing-the-right-model',
    categoryId: 'getting-started',
    title: 'Choosing the right model',
    description: 'When to use automatic routing vs manual model selection.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Choosing the Right Model\n\nTaskForceAI can automatically select models, or you can choose manually.\n\n## Automatic Routing (Recommended)\n\nLet TaskForceAI choose the best model for your task. This is the default and works well for most use cases.\n\n## Manual Selection\n\nFor specific needs, you can select a model manually:\n\n1. Click the model selector in the chat input\n2. Choose from available models\n3. Your selection applies to the current conversation\n\n## When to Select Manually\n\n- **Consistency**: When you need the same model throughout\n- **Testing**: When comparing model outputs\n- **Specific capabilities**: When you know which model is best\n\n## Model Categories\n\n- **Speed**: Fast models for simple tasks\n- **Quality**: Frontier models for complex reasoning\n- **Code**: Models optimized for programming\n- **Creative**: Models for writing and brainstorming\n    ',
  },
];
