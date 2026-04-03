# Prompttrace Project Structure

This monorepo uses `npm` workspaces to separate the SDKs, visual dashboard, and VSCode extension. All components communicate via a unified local-first data bus.

## Data Ownership & Flow

The entire system relies on `.prompttrace/traces.json` to handle communication. 
**SDK is the only writer. Everything else is read-only.**

```text
SDK → writes traces.json  
Extension → reads + reacts  
Dashboard → reads + visualizes

SDK → Storage → Extension + Dashboard
```

## Directory Map

```text
prompttrace/
├── apps/
│   ├── dashboard/              # Next.js Dashboard
│   │   ├── src/
│   │   │   └── app/
│   │   │       ├── api/traces/      # API exposing local .prompttrace data to Next.js
│   │   │       └── page.tsx         # Analytics graph and views
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── extension/              # VSCode Extension
│       ├── src/
│       │   ├── extension.ts         # VSCode entry and disposal 
│       │   ├── clipboard-monitor.ts # Polls env.clipboard every 2s for prompt-like strings
│       │   ├── prompt-detector.ts   # Checks "untitled" or markdown document typing
│       │   ├── inline-analyzer.ts   # Regex-based localized string optimization and sizing
│       │   ├── pattern-detector.ts  # NLP checks (action verbs, role indicators)
│       │   ├── integration.ts       # Chokidar binding for traces.json event listening
│       │   └── ui/popup.ts          # Notifications via vscode.window
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── sdk/                    # Core TypeScript SDK 
│   │   ├── src/
│   │   │   ├── wrapper.ts           # Intercepts openai.chat.completions.create calls
│   │   │   ├── storage.ts           # StorageEngine; finds root package.json to append traces.json
│   │   │   ├── optimizer.ts         # Algorithmic token compression logic
│   │   │   ├── tokenizer.ts         # tiktoken node-interface for sizing
│   │   │   ├── ai-analysis.ts       # Runs secondary LLM insights
│   │   │   └── insights.ts          # Rule-based impact simulations based on response chunk sizes
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── python-sdk/             # Core Python SDK
│       ├── prompttrace/
│       │   ├── wrapper.py           # Python dynamic binding analogous to wrapper.ts intercept
│       │   ├── storage.py           # File I/O traversing to the identical bus
│       │   ├── tokenizer.py         # Native python tiktoken module
│       │   └── insights.py          # Ported impact rules
│       └── setup.py                 # Setuptools definition
│
├── examples/
│   ├── basic/                  # TypeScript Reference
│   └── python-demo.py          # Python script demo
│
├── .prompttrace/               # Persisted telemetry artifacts (Git Ignored)
│   └── traces.json             # Append-only JSON event bus leveraged across all apps silently
├── PROJECT_STRUCTURE.md        # Current File
└── README.md                   # Installation & Setup Guides
```

## Module Responsibilities

### 1. `packages/sdk` & `packages/python-sdk`
The producers. `wrapper.ts` and `wrapper.py` proxy `.create` calls natively. When called, they calculate tokens via `tokenizer`, execute simple logic heuristics via `insights`, and use `StorageEngine` to locate the project root and `fs.appendFile` into `.prompttrace/traces.json`.

### 2. `apps/dashboard`
The visual consumer. A React/Next app that calls `/api/traces` (a Node API parsing the local `traces.json`). It handles the bulky visualizations.

### 3. `apps/extension`
The watcher and preemptive responder. It acts autonomously in the background:
- **Clipboard Monitor (`clipboard-monitor.ts`)**: Polls `vscode.env.clipboard.readText()` every 2s in a background interval, passing clipboard content into `inline-analyzer.ts`.
- **Prompt Detector (`prompt-detector.ts`)**: Watches `vscode.workspace.onDidChangeTextDocument` to analyze typed strings before they are submitted.
- **Storage Integration (`integration.ts`)**: Binds a `chokidar` watcher to `.prompttrace/traces.json` to immediately react when the SDK drops a new trace.
