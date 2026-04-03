# Prompttrace
Reduce your LLM costs by 30–60% with one line of code.

Prompttrace is a local-first optimization suite that detects context bloat, tracks caching hotspots, and simulates cost-saving prompt restructures. 

---

## The Problem
Most developers log prompts, but few actively optimize them. Over time, conversation history expands uncheckably, redundant instructions bulk up system prompts, and duplicate identical requests are fired endlessly. This unchecked "Context Bloat" silently drains your monthly API budgets.

## Enter Prompttrace
By wrapping your OpenAI-compatible client, Prompttrace instantly upgrades your observability chain into an Optimization Engine:

1. **Highlight Cost:** Automatically multiplies trace cost by 10,000 to highlight severe monthly financial impact.
2. **Impact Simulation:** Explicitly calculates how much money you could save right now if you trimmed system or history tokens.
3. **Smart Hotspot Detection:** Tracks identical prompt hashes globally, warning you if caching is actively being ignored.
4. **Local Prompting Toolkit:** Out-of-the-box local prompt algorithmic trimming (`optimizePrompt`) and token diffing (`compare`) directly in the SDK.
5. **Polyglot Ecosystem:** Officially supports both TypeScript/Node.js and Python explicitly.

## How It Actually Works

It operates entirely offline through local files. 

**Component Roles:**
- **Extension** → runs *before* API call
- **SDK** → runs *after* API call 
- **Dashboard** → runs *after* data is stored 

**The Core Execution Flow:**
`traceLLM` → `wrapper.ts` → `tokenizer` → `insights` → `storage` → `traces.jsonl` → `extension watcher` → `popup / dashboard`

**The VSCode Extension (The Core Feature):**
The extension sits inside your editor to catch bloat *before* you send a payload.
- It polls your clipboard (`clipboard-monitor.ts`) and watches document changes (`prompt-detector.ts`).
- It dedups text locally and calculates optimization potential using regex/NLP.
- If it detects a highly bloated prompt, it surfaces an IDE popup detailing exact token savings and giving you a one-click button to apply algorithmic or AI reductions.

---

## Quick Start

### 1. Installation

**For TypeScript / Node.js:**
```bash
git clone https://github.com/your-username/prompttrace.git
cd prompttrace
npm install
npm run build
```

**For Python:**
```bash
pip install -e packages/python-sdk
```

### 2. Wrapping your LLM Client

**TypeScript / Node.js:**
```ts
import OpenAI from "openai";
import { traceLLM } from "prompttrace";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// traceLLM intercepts the OpenAI client by overriding the create method
const client = traceLLM(openai, {
  log: true,           
  store: "local",      // Saves output to .prompttrace/traces.jsonl
  aiAnalysis: true     
});

await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "What is the capital of France?" }]
});
```

**Python:**
```python
import os
from openai import OpenAI
from prompttrace import trace_llm

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
traced_client = trace_llm(client, config={"log": True, "store": "local"})

response = traced_client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is the capital of France?"}]
)
```

### 3. Launch the Ecosystem 
Visually map your context explosions and explicit savings right away.

```bash
cd apps/dashboard
npm run dev
```

Navigate to `http://localhost:3000` to review Projected Monthly ROI Savings, Actionable Impact Simulations, and Hotspot Cache mapping.

---

## Configuration & AI Optimization (Groq / OpenAI)

Prompttrace can utilize external LLMs inside the VSCode extension to actively restructure your bloated prompts locally.

By default, the AI Analyzer uses `gpt-4o-mini`. However, you can configure **Groq**, **OpenRouter**, or other custom providers to avoid OpenAI costs.

In VS Code `settings.json`, simply configure:
```json
// Use Groq for blazing fast free completions
"prompttrace.aiModel": "llama-3.1-8b-instant",
"prompttrace.apiUrl": "https://api.groq.com/openai/v1",
"prompttrace.apiKey": "gsk_your_groq_api_key_here"
```

## Security & Storage Guarantees
- **Local First Guarantee:** PrompTrace runs exactly where your code runs. Traces stay inside `.prompttrace/traces.jsonl`. No code leaks.
- **Race Condition Safe:** The `.jsonl` append architecture natively handles extreme concurrency boundaries natively between Node.JS strings and Python async loops without Database bloat.
