# Prompttrace
Local-first LLM observability and optimization for developers.

> Think of it as Grammarly + Chrome DevTools for LLM prompts.

## ⚡ Key Guarantees
- **No network calls required** (fully local/private by default)
- **Works with existing code** (standard OpenAI-compatible clients)
- **Concurrency Safe** (append-only JSONL storage model)

---

> [!TIP]
> Works out-of-the-box with existing OpenAI-compatible clients. No migration required.

Prompttrace is a local-first optimization suite that detects context bloat, tracks caching hotspots, and simulates cost-saving prompt restructures—all without your data ever leaving your machine. 

Reduce your LLM costs by **30–60%** with one line of code.

---

## Why Prompttrace

Unlike traditional LLM logging tools:
- **No External Servers:** Traces stay in your local filesystem. No vendor lock-in.
- **Cross-Language Native:** First-class support for both **TypeScript/Node.js** and **Python**.
- **Real-time IDE Feedback:** Catch context bloat *inside* your editor, not just in a post-hoc dashboard.
- **Security First:** Zero-leak architecture. No PII is ever sent to a third-party observability cloud.

---

## Who is this for

- **Developers** building with OpenAI / Groq / LLM APIs
- **Teams** debugging high token costs in production
- **Anyone** using long prompts, agents, or chat history

---

## Execution Lifecycle

Prompttrace integrates into your entire development loop:

1. **Before request (Extension)**  
   Detects prompt bloat in real-time as you type or copy-paste (Clipboard + Editor polling). Surfaced as inline IDE feedback.

2. **During request (SDK)**  
   Intercepts LLM calls to measure exact tokens, cost, and latency using standard `OpenAI` client wrappers.

3. **After request (Storage + Dashboard)**  
   Persists traces to `traces.jsonl` and surfaces deep analytics, ROI projections, and caching hotspots.

---

## Quick Start

### 1. Installation

**For TypeScript / Node.js:**
```bash
npm install prompttrace
```

**For Python:**
```bash
pip install prompttrace-sdk
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

### 3. Launch the Ecosystem (Optional)
Visually map your context explosions and explicit savings right away. 

> The dashboard is optional. The SDK and extension work independently.

```bash
cd apps/dashboard
npm run dev
```

Navigate to `http://localhost:3000` to review Projected Monthly ROI Savings, Actionable Impact Simulations, and Hotspot Cache mapping.

---

## Configuration & AI Optimization (Groq / OpenAI)

Prompttrace can utilize external LLMs inside the VSCode extension to actively restructure your bloated prompts locally.

By default, the AI Analyzer uses `gpt-4o-mini`. However, you can configure **Groq**, **OpenRouter**, or other custom providers to avoid OpenAI costs.

In VS Code `settings.json`:
```json
{
  // Use Groq for blazing fast free completions
  "prompttrace.aiModel": "llama-3.1-8b-instant",
  "prompttrace.apiUrl": "https://api.groq.com/openai/v1",
  "prompttrace.apiKey": "gsk_your_groq_api_key_here"
}
```

## Security & Storage Guarantees
- **Local First Guarantee:** Prompttrace runs exactly where your code runs. Traces stay inside `.prompttrace/traces.jsonl`.
- **Concurrency Safe:** Uses append-only `traces.jsonl` writes to avoid corruption under parallel LLM calls across Node.js and Python.
