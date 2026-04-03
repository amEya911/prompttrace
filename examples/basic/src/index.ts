import OpenAI from 'openai';
import { traceLLM, optimizePrompt, compare } from 'prompttrace';
import * as dotenv from 'dotenv';
import fs from "fs";
import path from "path";

dotenv.config();

// Standard OpenAI initialization
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'fake-api-key-for-demo',
});

// Mock the openAI client BEFORE wrapping it
if (process.env.OPENAI_API_KEY === undefined) {
  (openai.chat.completions as any).create = async (params: any) => {
    return {
      id: "chatcmpl-mock",
      model: params.model,
      choices: [{ message: { role: "assistant", content: "This is a mocked response." } }],
      usage: { prompt_tokens: null, completion_tokens: 12, total_tokens: null }
    };
  };
}

// Wrap the client with Prompttrace
const client = traceLLM(openai, {
  log: true,
  store: "local"
});

async function main() {
  console.log("Running Prompttrace Optimization demonstration...");

  // 🔥 Show where data is being written
  console.log(
    "[Prompttrace] Writing to:",
    path.join(process.cwd(), ".prompttrace", "traces.jsonl")
  );

  try {
    // ====================================
    // 1. Standard Request
    // ====================================
    const badMessages = [
      { role: "system", content: "You are a helpful assistant. ".repeat(200) },
      { role: "user", content: "tell me a joke. please would you mind." }
    ];

    console.log("\n====================================");
    console.log("1. Running Standard Request");
    console.log("====================================");

    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: badMessages
    });

    // ====================================
    // 2. Optimization Engine Demo
    // ====================================
    console.log("\n====================================");
    console.log("2. Prompttrace Optimization Engine Demo");
    console.log("====================================");

    const optimizedMessages = optimizePrompt(badMessages);
    const comparison = compare(
      "gpt-4o-mini",
      badMessages,
      optimizedMessages
    );

    console.log(`\x1b[33mOriginal Tokens: ${comparison.originalTokens} | Cost: $${comparison.originalCost.toFixed(5)}\x1b[0m`);
    console.log(`\x1b[32mOptimized Tokens: ${comparison.newTokens} | Cost: $${comparison.newCost.toFixed(5)}\x1b[0m`);
    console.log(`Token Diff:       ↓ ${comparison.diffTokens}`);
    console.log(`\x1b[32mProjected Mo ROI: $${comparison.projectedMonthlySavings.toFixed(2)}/mo (at 10k calls)\x1b[0m`);

    // ====================================
    // 3. Cache Hotspot Simulation
    // ====================================
    console.log("\n====================================");
    console.log("3. Triggering Caching Hotspots");
    console.log("====================================");

    const repeatedQuery = [
      { role: "system", content: "You are a calculator." },
      { role: "user", content: "1 + 1" }
    ];

    await client.chat.completions.create({ model: "gpt-4o-mini", messages: repeatedQuery });
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: repeatedQuery });
    await client.chat.completions.create({ model: "gpt-4o-mini", messages: repeatedQuery });

    // ====================================
    // 4. 🔥 Concurrency Stress Test
    // ====================================
    console.log("\n====================================");
    console.log("4. Concurrency Stress Test");
    console.log("====================================");

    await Promise.all(
      Array.from({ length: 20 }).map((_, i) =>
        client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a fast responder." },
            { role: "user", content: `Request number ${i}` }
          ]
        })
      )
    );

    console.log("✅ Concurrency test completed");

    // ====================================
    // 5. 🔥 JSONL Integrity Check
    // ====================================
    console.log("\n====================================");
    console.log("5. JSONL Integrity Check");
    console.log("====================================");

    const file = path.join(process.cwd(), ".prompttrace", "traces.jsonl");

    const lines = fs.readFileSync(file, "utf-8")
      .split("\n")
      .filter(Boolean);

    let valid = true;

    for (const line of lines) {
      try {
        JSON.parse(line);
      } catch {
        valid = false;
        break;
      }
    }

    console.log(valid ? "✅ All JSONL lines valid" : "❌ Corruption detected");
    console.log(`Total lines: ${lines.length}`);

    console.log("\nDone! Run the dashboard to view weaponized cost insights.");
  } catch (err) {
    console.error("Error running example:", err);
  }
}

main();