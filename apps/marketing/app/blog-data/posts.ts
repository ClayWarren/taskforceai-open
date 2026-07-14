type BlogPostSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type BlogPost = {
  slug: string;
  title: string;
  date: string;
  tag: string;
  readTime: string;
  summary: string;
  description: string;
  highlights: string[];
  sections: BlogPostSection[];
};

export const blogPosts: BlogPost[] = [
  {
    slug: 'artifacts-and-sites',
    title: 'Artifacts and hosted sites turn answers into shippable work',
    date: 'June 8, 2026',
    tag: 'Artifacts',
    readTime: '4 min read',
    summary:
      'TaskForceAI can now produce interactive artifacts and publish them as live hosted sites, so an agent’s output can go straight from chat to a shareable URL.',
    description:
      'TaskForceAI added interactive artifacts and one-step hosted sites, letting agent output move from the conversation to a live, shareable URL.',
    highlights: [
      'Interactive artifacts rendered alongside the conversation',
      'Publish agent output as a live hosted site with a shareable URL',
      'A clear path from generated content to something you can actually ship',
    ],
    sections: [
      {
        heading: 'From answer to artifact',
        paragraphs: [
          'Plenty of work does not end at text. It ends at something you can open, click, and share. This week we added artifacts and hosted sites so TaskForceAI can produce real, interactive output instead of describing it.',
          'An artifact lives next to the conversation that created it. The agent builds it, you review it in place, and the chat keeps the full trail of how it came together.',
        ],
      },
      {
        heading: 'Publish without leaving the flow',
        paragraphs: [
          'The bigger step is hosting. When an artifact is ready, TaskForceAI can publish it as a live site with its own URL. That turns a prototype, a report, or a small app into something you can hand to someone else immediately.',
        ],
        bullets: [
          'Interactive artifacts you can review in the conversation',
          'One step from artifact to a published, hosted site',
          'Shareable URLs so output leaves the chat as real work',
        ],
      },
      {
        heading: 'Distinct from generated files',
        paragraphs: [
          'This sits alongside generated file downloads rather than replacing them. Files are for deliverables you collect; artifacts and sites are for output you publish and share live. Together they cover the full range of what an agent should be able to hand back.',
        ],
      },
    ],
  },
  {
    slug: 'agent-teams-everywhere',
    title: 'Agent Teams now work across every TaskForceAI surface',
    date: 'June 8, 2026',
    tag: 'Product',
    readTime: '4 min read',
    summary:
      'The same orchestrated agent workflow now runs across web, desktop, mobile, and the terminal so teams can move work between surfaces without changing how they think.',
    description:
      'TaskForceAI Agent Teams are now available across web, desktop, mobile, and terminal workflows with consistent orchestration and progress streaming.',
    highlights: [
      'Shared agent-team behavior across web, desktop, mobile, and TUI',
      'Mode and generation parity for research, images, video, and artifacts',
      'Custom orchestration config: per-role models, team size, and budget',
      'A cleaner handoff between local execution and hosted task history',
    ],
    sections: [
      {
        heading: 'One workflow, many surfaces',
        paragraphs: [
          'TaskForceAI is built around a simple product promise: ask once, let specialized agents coordinate the work, and keep the trail visible. This week we tightened that promise across the surfaces people actually use day to day.',
          'Agent Teams now feel consistent whether you start from the browser, a native desktop session, a mobile device, or the terminal. The goal is not feature parity for its own sake. The goal is confidence that the same task structure, progress model, and final output survive the surface switch.',
        ],
      },
      {
        heading: 'Generation parity matters',
        paragraphs: [
          'The biggest lift was making generated outputs behave like first-class results everywhere. Research runs, image generation, video generation, and file-producing workflows now share clearer execution semantics across the product.',
          'That consistency makes advanced workflows easier to trust. A team can start with a quick terminal run, continue on desktop, and review from the web without losing the mental model of what the agents did.',
        ],
        bullets: [
          'Shared mode handling for agent-driven tasks',
          'Consistent progress updates while work is running',
          'Generated results surfaced as durable outputs instead of hidden implementation details',
        ],
      },
      {
        heading: 'Tune the team to the task',
        paragraphs: [
          'Not every task wants the same team. This week we exposed custom orchestration configuration so you can shape how an agent team runs before it starts.',
          'You can assign specific models to specific roles, set how many agents participate, and put a budget on the run. Your configuration persists, so a workflow you tuned once behaves the same way the next time you reach for it.',
        ],
        bullets: [
          'Per-role model selection so each role uses the right model',
          'Adjustable team size, from a single agent up to twenty',
          'Optional budget to cap how much a run can spend',
        ],
      },
      {
        heading: 'What comes next',
        paragraphs: [
          'We will keep tightening the handoff between local and hosted execution. The more surfaces TaskForceAI supports, the more important it becomes that the platform feels like one system instead of a collection of clients.',
        ],
      },
    ],
  },
  {
    slug: 'computer-use-local-and-virtual',
    title: 'Computer use comes to your machine and the cloud',
    date: 'June 7, 2026',
    tag: 'Agents',
    readTime: '4 min read',
    summary:
      'TaskForceAI agents can now operate a real computer — locally through the desktop app or in a cloud Linux desktop — with a live theater view of every action.',
    description:
      'TaskForceAI computer use now runs both locally via the desktop app and in cloud Linux desktops, with a live Computer Theater view of agent actions.',
    highlights: [
      'Local computer use that runs on your own machine through the desktop app',
      'Virtual computer use on a cloud Linux desktop for isolated runs',
      'Computer Theater shows a live, annotated feed of every agent action',
    ],
    sections: [
      {
        heading: 'Two ways to give an agent a computer',
        paragraphs: [
          'Some tasks need more than tool calls. They need an agent that can actually drive a computer: open apps, click around, and work through a real interface. This week computer use arrived in two forms.',
          'Locally, the desktop app lets an agent operate your own machine. Virtually, TaskForceAI can spin up a cloud Linux desktop so the agent works in an isolated environment instead of yours. Same capability, different blast radius, and you choose which fits the task.',
        ],
      },
      {
        heading: 'Watch the work happen',
        paragraphs: [
          'Computer use is only trustworthy if you can see it. The Computer Theater view expands automatically when an agent starts working, streaming a live feed of the desktop with clicks and cursor movement drawn directly on screen.',
        ],
        bullets: [
          'Local execution on your machine via the desktop app',
          'Virtual cloud Linux desktops for isolated, disposable runs',
          'Live annotated feed with an auto-expanding theater and manual controls',
        ],
      },
      {
        heading: 'Built to be observed, not hidden',
        paragraphs: [
          'The whole point is a visible agent. Whether it runs locally or in the cloud, computer use keeps the actions on screen so you can follow along, step in, or stop the run when you need to.',
        ],
      },
    ],
  },
  {
    slug: 'local-coding-workspace',
    title: 'A real coding workspace, local and remote',
    date: 'June 7, 2026',
    tag: 'Agents',
    readTime: '4 min read',
    summary:
      'The desktop app and TUI now run a local coding agent with a file tree, diff preview, and terminal — and can drive a remote machine over SSH.',
    description:
      'TaskForceAI added a local coding agent on desktop and TUI with a file tree, diff preview, and terminal, plus SSH-connected remote app-server environments.',
    highlights: [
      'Local coding agent on the desktop app and in the TUI',
      'File tree, diff preview, and terminal built into the workspace',
      'Connect to remote machines over SSH and run the same workspace there',
    ],
    sections: [
      {
        heading: 'Coding where your code lives',
        paragraphs: [
          'A coding agent is most useful when it works against real files, not a sandboxed copy. This week we brought a local coding agent to the desktop app and the TUI so it can read, edit, and run code in your actual workspace.',
          'The desktop app runs its own local app-server and drives that workspace directly. The agent operates the project the way you do, and you stay in control of what it touches.',
        ],
      },
      {
        heading: 'The UX that makes it reviewable',
        paragraphs: [
          'Local editing only works if you can see what changed. The workspace now includes a file tree to navigate the project, a diff preview to review edits before they land, and a terminal for shell access alongside the agent.',
        ],
        bullets: [
          'Workspace file tree for navigating the project',
          'Diff preview so every change is reviewable before you accept it',
          'Integrated terminal for shell commands next to the agent',
        ],
      },
      {
        heading: 'Local or remote, same workspace',
        paragraphs: [
          'The same workspace can target a remote machine. Probe and connect to a host over SSH, and the desktop app routes its app-server calls to that environment — so you can run the coding agent on a server or a beefier box without changing how you work.',
        ],
      },
    ],
  },
  {
    slug: 'generated-files-in-chat',
    title: 'Generated files now arrive as real chat downloads',
    date: 'June 7, 2026',
    tag: 'Artifacts',
    readTime: '4 min read',
    summary:
      'Spreadsheet, PDF, chart, document, presentation, CSV, and archive generation now produces durable download cards directly under assistant replies.',
    description:
      'TaskForceAI now delivers generated files as downloadable artifacts in chat, keeping progress UI focused on execution and final files attached to the answer.',
    highlights: [
      'Download cards render below assistant replies',
      'Generated-file tools support spreadsheets, PDFs, charts, documents, presentations, CSVs, and archives',
      'Progress UI stays focused on execution instead of becoming a file shelf',
    ],
    sections: [
      {
        heading: 'Files should feel finished',
        paragraphs: [
          'A generated spreadsheet or PDF is only useful if it lands as an actual file. This week we upgraded generated-file delivery so TaskForceAI can produce durable downloads directly in the chat flow.',
          'The assistant reply now owns the final artifact. Tool progress remains visible while the task is running, but completed files appear below the answer where people expect to collect the result.',
        ],
      },
      {
        heading: 'More artifact types, less ambiguity',
        paragraphs: [
          'We expanded the generated-file path for the formats teams ask for most often: spreadsheets, PDFs, charts, documents, presentations, CSVs, and archives. The platform can now steer file requests toward the right generator instead of falling back to prose when the user clearly needs a deliverable.',
        ],
        bullets: [
          'Spreadsheet and CSV outputs for analysis workflows',
          'PDF and document outputs for reports',
          'Charts and presentations for shareable summaries',
          'Archives for multi-file deliverables',
        ],
      },
      {
        heading: 'A cleaner chat contract',
        paragraphs: [
          'The product boundary is deliberate. Progress belongs in the progress area. Final files belong with the answer. That separation makes long-running work easier to follow and makes completed outputs easier to find later.',
        ],
      },
    ],
  },
  {
    slug: 'media-generation',
    title: 'Image and video generation, consistent across surfaces',
    date: 'June 6, 2026',
    tag: 'Media',
    readTime: '3 min read',
    summary:
      'Media generation now produces images and 720p video with inline playback, routed through AI Gateway, and behaves the same across web, desktop, mobile, and the TUI.',
    description:
      'TaskForceAI media generation now covers images and 720p video with inline playback, routed through Vercel AI Gateway, with parity across web, desktop, mobile, and TUI.',
    highlights: [
      'Image and video generation with inline playback',
      'Video defaults to 720p with reliable result handling',
      'Routed through AI Gateway with parity across every surface',
    ],
    sections: [
      {
        heading: 'Media as a first-class result',
        paragraphs: [
          'Generated media should feel like part of the answer, not an attachment bolted on afterward. This week we hardened the media generation path so images and video come back as real, playable results in the conversation.',
          'Video now defaults to 720p and plays inline, and we fixed the routing and result handling so generated media lands reliably instead of getting lost between the model and the UI.',
        ],
      },
      {
        heading: 'The same behavior everywhere',
        paragraphs: [
          'We routed image generation through AI Gateway and brought media generation to parity across surfaces, including the new TUI mode. A generation you run on the web behaves the same on desktop, mobile, or the terminal.',
        ],
        bullets: [
          'Inline image and video results in the conversation',
          '720p video with playback',
          'Consistent generation across web, desktop, mobile, and TUI',
        ],
      },
    ],
  },
  {
    slug: 'reviewable-memory',
    title: 'Memory you can see, check, and trust',
    date: 'June 6, 2026',
    tag: 'Memory',
    readTime: '3 min read',
    summary:
      'TaskForceAI added desktop Screen Memory controls and made stored memory reviewable, with clear provenance for where each remembered fact came from.',
    description:
      'TaskForceAI improved memory with desktop Screen Memory controls and reviewable provenance, so users can see and verify what the system remembers.',
    highlights: [
      'Desktop Screen Memory controls for what the app can remember from your screen',
      'Reviewable memory so you can see what is stored',
      'Provenance for each remembered fact, traced back to its source',
    ],
    sections: [
      {
        heading: 'Memory has to be inspectable',
        paragraphs: [
          'Memory makes an assistant more useful, but only if you trust it. This week we focused on two sides of that trust: control over what gets remembered, and visibility into what already has been.',
          'On the desktop, Screen Memory controls let you decide what the app can capture and remember from your screen. Nothing about memory should feel like it happens behind your back.',
        ],
      },
      {
        heading: 'Provenance over guesswork',
        paragraphs: [
          'We also improved memory provenance and reviewability. Stored memories carry where they came from, so when the system recalls something you can trace it to its source and correct it if it is wrong.',
        ],
        bullets: [
          'Screen Memory controls on the desktop app',
          'A reviewable view of what is stored',
          'Provenance linking each memory back to its origin',
        ],
      },
    ],
  },
  {
    slug: 'web-search-and-code-execution',
    title: 'Sharper web search and sandboxed code execution',
    date: 'June 6, 2026',
    tag: 'Tools',
    readTime: '3 min read',
    summary:
      'Agents get deeper web search with visible sources and a sandboxed code execution tool, so they can both gather current information and actually run code.',
    description:
      'TaskForceAI improved web search depth and source visibility and runs code execution in isolated sandboxes, giving agents stronger research and compute tools.',
    highlights: [
      'Deeper web search with visible, traceable sources',
      'Sandboxed code execution for real computation',
      'Both tools available to agents during a run',
    ],
    sections: [
      {
        heading: 'Better answers need better inputs',
        paragraphs: [
          'Two tools do a lot of the heavy lifting in a good agent run: the ability to look things up, and the ability to compute. This week we sharpened both.',
          'Web search now goes deeper and surfaces its sources, so research-heavy answers show where the information came from instead of asking you to take them on faith. We also improved how current news gets synthesized into a usable answer.',
        ],
      },
      {
        heading: 'Run the code, do not just describe it',
        paragraphs: [
          'Code execution runs in an isolated sandbox, so an agent can actually execute code to test an idea, transform data, or check a result rather than only reasoning about it. We moved sandboxing onto Daytona for a consistent, disposable execution environment.',
        ],
        bullets: [
          'Web search with greater depth and source visibility',
          'Sandboxed code execution on disposable environments',
          'Stronger synthesis of current information',
        ],
      },
    ],
  },
  {
    slug: 'finance-workflows-and-plaid',
    title: 'Finance workflows get secure account context with Plaid',
    date: 'June 6, 2026',
    tag: 'Integrations',
    readTime: '4 min read',
    summary:
      'TaskForceAI now supports read-only Plaid-powered finance context, finance settings, and product-neutral prompt templates for research and planning workflows.',
    description:
      'TaskForceAI added read-only Plaid finance integration, finance settings, and compact prompt workflows for richer financial research and planning.',
    highlights: [
      'Read-only Plaid Link support for connected financial context',
      'Finance settings for connection management and sync',
      'Finance prompts live behind the general Prompts entry point',
    ],
    sections: [
      {
        heading: 'Richer context for financial work',
        paragraphs: [
          'Finance workflows often need more than a blank prompt. They need current context, repeatable summaries, and a way to ask research questions without manually rebuilding the same data packet every time.',
          'This week we added the repo-side foundation for read-only Plaid-backed context. Users can connect accounts through Plaid Link, sync finance data, and use that context in financial research and planning workflows.',
        ],
      },
      {
        heading: 'Useful without taking over the product',
        paragraphs: [
          'Finance is powerful, but TaskForceAI is not becoming a finance-only product. We moved finance starters behind a compact general Prompts entry point so the first screen stays broad and the finance affordances appear when they are relevant.',
        ],
        bullets: [
          'Read-only Transactions and Recurring Transactions access',
          'Connection and sync controls in profile settings',
          'Graceful memory-only behavior when Plaid is not configured',
        ],
      },
      {
        heading: 'Built for trust',
        paragraphs: [
          'The integration is scoped around read-only context and explicit user connection flows. That lets agents reason over financial information while preserving a clear boundary between analysis, recommendations, and user-controlled action.',
        ],
      },
    ],
  },
  {
    slug: 'desktop-mobile-pairing',
    title: 'Pair mobile with desktop and keep working',
    date: 'June 5, 2026',
    tag: 'Continuity',
    readTime: '3 min read',
    summary:
      'You can now pair the mobile app with desktop, follow a workspace from either device, and pick up where you left off through a shared continuity sidebar.',
    description:
      'TaskForceAI added desktop and mobile pairing with deep links, persisted sessions, and a continuity sidebar so work moves between devices.',
    highlights: [
      'Pair the mobile app with desktop, including deep-link pairing',
      'Persisted pairing sessions that survive restarts',
      'A continuity sidebar to follow the same workspace across devices',
    ],
    sections: [
      {
        heading: 'Work does not stay on one device',
        paragraphs: [
          'People start something on a laptop and want to check it from their phone. This week we built device pairing so the desktop and mobile apps can work together instead of as two separate clients.',
          'Pairing works through a card and deep links, and the session persists, so you connect once and the devices stay aware of each other.',
        ],
      },
      {
        heading: 'Continuity, not just a second screen',
        paragraphs: [
          'A continuity sidebar lets you follow the same workspace from either device and continue work that is already in progress. The mobile app can step into a desktop workspace flow rather than starting from scratch.',
        ],
        bullets: [
          'Pairing card and deep-link pairing between devices',
          'Persisted pairing sessions across restarts',
          'Continuity sidebar and shared workspace flow',
        ],
      },
    ],
  },
  {
    slug: 'introducing-taskforceai',
    title: 'Introducing TaskForceAI',
    date: 'January 8, 2026',
    tag: 'Launch',
    readTime: '5 min read',
    summary:
      'A first look at the TaskForceAI multi-agent orchestration platform, how it works, and what shipped in the public developer preview.',
    description:
      'A first look at TaskForceAI architecture, orchestration, local-first principles, SDKs, CLI, desktop, and mobile apps.',
    highlights: [
      'Four-agent orchestration with streaming telemetry and validation',
      'Local-first data model with offline sync and browser persistence',
      'SDKs, CLI, desktop, and mobile apps designed so teams can work anywhere',
    ],
    sections: [
      {
        heading: 'Why multi-agent orchestration?',
        paragraphs: [
          'The best answers rarely come from a single model pass. TaskForceAI coordinates specialized agents, streams tool activity to the UI, synthesizes the work, and validates the result before final delivery.',
          'The result is repeatable reasoning that exposes its work instead of hiding it.',
        ],
      },
      {
        heading: 'What shipped in the developer preview',
        paragraphs: [
          'The developer preview gave builders the foundation for multi-agent integrations: an open-source CLI, type-safe SDKs, REST APIs, and documentation for building against TaskForceAI locally before moving to hosted execution.',
        ],
        bullets: [
          'Open-source CLI with local development support',
          'Type-safe SDKs for TypeScript, Python, Go, and Rust',
          'Documentation for the REST API, SDKs, and CLI',
        ],
      },
      {
        heading: 'Local first by default',
        paragraphs: [
          'Conversations, tool logs, and auth state persist locally so work can continue through poor connectivity. When connectivity returns, data syncs back through the same APIs that power the online experience.',
        ],
      },
      {
        heading: 'What we are building next',
        paragraphs: [
          'Since launch, we have been focused on richer agent teams, generated artifacts, mobile and desktop parity, and deeper integrations that make TaskForceAI useful for real operational work.',
        ],
      },
    ],
  },
];

export const landingBlogPosts = blogPosts.slice(0, 3);

function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

export function getRequiredBlogPost(slug: string) {
  const post = getBlogPost(slug);
  if (!post) {
    throw new Error(`Missing blog post: ${slug}`);
  }
  return post;
}
