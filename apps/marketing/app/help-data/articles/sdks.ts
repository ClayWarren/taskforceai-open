import type { HelpArticle } from './types';

export const sdksArticles: HelpArticle[] = [
  {
    slug: 'typescript-sdk-quickstart',
    categoryId: 'sdks',
    title: 'TypeScript SDK quickstart',
    description: 'Get started with the TypeScript SDK.',
    lastUpdated: '2026-06-06',
    content: `
# TypeScript SDK Quickstart

Build with TaskForceAI using TypeScript.

## Installation

\`\`\`bash
npm install taskforceai-sdk
# or
bun add taskforceai-sdk
\`\`\`

## Setup

\`\`\`typescript
import { TaskForceAI } from 'taskforceai-sdk';

const client = new TaskForceAI({
  apiKey: process.env.TASKFORCEAI_API_KEY,
});
\`\`\`

## Basic Usage

\`\`\`typescript
const result = await client.runTask('Analyze this repository');
console.log(result.result);
\`\`\`

## Streaming

\`\`\`typescript
const stream = client.runTaskStream('Map the risks in this codebase');

for await (const status of stream) {
  console.log(\`\${status.status}: \${status.result ?? '...'}\`);
}
\`\`\`

## Mock Mode

Use mock mode when building local integrations without an API key:

\`\`\`typescript
const client = new TaskForceAI({ mockMode: true });
const result = await client.runTask('Test your integration');
\`\`\`

## Next Steps

See the [full documentation](https://docs.taskforceai.chat/docs/typescript-sdk) for the canonical SDK reference.
    `,
  },
  {
    slug: 'python-sdk-quickstart',
    categoryId: 'sdks',
    title: 'Python SDK quickstart',
    description: 'Get started with the Python SDK.',
    lastUpdated: '2026-06-06',
    content: `
# Python SDK Quickstart

Build with TaskForceAI using Python.

## Installation

\`\`\`bash
python -m pip install taskforceai
\`\`\`

## Synchronous Usage

\`\`\`python
from taskforceai import TaskForceAIClient

client = TaskForceAIClient(api_key="your-api-key")
result = client.run_task("Analyze this repository")
print(result["result"])
\`\`\`

## Async Usage

\`\`\`python
import asyncio
from taskforceai import AsyncTaskForceAIClient

async def main():
    async with AsyncTaskForceAIClient(api_key="your-api-key") as client:
        result = await client.run_task("Summarize the latest updates")
        print(result["result"])

asyncio.run(main())
\`\`\`

## Streaming

\`\`\`python
stream = client.run_task_stream("Map open security issues")

for status in stream:
    print(f"{status['status']}: {status.get('result')}")
\`\`\`

## Next Steps

See the [full documentation](https://docs.taskforceai.chat/docs/python-sdk) for the canonical SDK reference.
    `,
  },
  {
    slug: 'rust-sdk-quickstart',
    categoryId: 'sdks',
    title: 'Rust SDK quickstart',
    description: 'Get started with the Rust SDK.',
    lastUpdated: '2026-06-06',
    content: `
# Rust SDK Quickstart

Build with TaskForceAI using Rust.

## Installation

\`\`\`bash
cargo add taskforceai-sdk
\`\`\`

## Setup

\`\`\`rust
use taskforceai_sdk::{TaskForceAI, TaskForceAIOptions};

#[tokio::main]
async fn main() {
    let client = TaskForceAI::new(TaskForceAIOptions {
        api_key: Some("your-api-key-here".to_string()),
        ..Default::default()
    })
    .expect("failed to create client");

    let status = client
        .run_task("Analyze this repository", None, None, None)
        .await
        .expect("task failed");

    if let Some(result) = status.result {
        println!("Result: {}", result);
    }
}
\`\`\`

## Streaming

\`\`\`rust
use futures_util::StreamExt;

let mut stream = client.run_task_stream("Long running task", None).await?;

while let Some(event) = stream.next().await {
    let status = event?;
    println!("Status: {}", status.status);
}
\`\`\`

## Next Steps

See the [full documentation](https://docs.taskforceai.chat/docs/rust-sdk) for the canonical SDK reference.
    `,
  },
  {
    slug: 'go-sdk-quickstart',
    categoryId: 'sdks',
    title: 'Go SDK quickstart',
    description: 'Get started with the Go SDK.',
    lastUpdated: '2026-06-06',
    content: `
# Go SDK Quickstart

Build with TaskForceAI using Go.

## Installation

\`\`\`bash
go get github.com/ClayWarren/taskforceai-open/packages/sdk-go
\`\`\`

## Setup

\`\`\`go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/ClayWarren/taskforceai-open/packages/sdk-go"
)

func main() {
    client := taskforceai.NewClient(taskforceai.TaskForceAIOptions{
        APIKey: "your-api-key-here",
    })

    status, err := client.RunTask(context.Background(), "Analyze this repository", nil, 0, 0, nil)
    if err != nil {
        log.Fatal(err)
    }

    if status.Result != nil {
        fmt.Printf("Result: %s\\n", *status.Result)
    }
}
\`\`\`

## Streaming

\`\`\`go
stream, err := client.RunTaskStream(context.Background(), "Summarize this article", nil)
if err != nil {
    log.Fatal(err)
}
defer stream.Close()
\`\`\`

## Next Steps

See the [full documentation](https://docs.taskforceai.chat/docs/go-sdk) for the canonical SDK reference.
    `,
  },
];
