import fs from 'fs';
import path from 'path';
import { StorageEngine } from '../src/storage';
import { traceLLM } from '../src/wrapper';

describe('Storage & Wrapper Integration', () => {
  const root = process.cwd();
  const dirPath = path.join(root, '.prompttrace');
  const filePath = path.join(dirPath, 'traces.jsonl');

  beforeEach(() => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  afterAll(() => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  it('safely handles 20 concurrent writes to JSONL without collision', async () => {
    // Mock standard OpenAI Client setup pattern
    const mockClient = {
      chat: {
        completions: {
          create: async (params: any) => {
            return {
              choices: [{ message: { content: "Test response" } }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            };
          }
        }
      }
    };

    const tracedClient = traceLLM(mockClient, { log: false, store: 'local', aiAnalysis: false });

    // Execute 20 calls fully parallel using Promise.all
    const promises = Array.from({ length: 20 }).map((_, i) => {
      return tracedClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Message ${i}` }]
      });
    });

    await Promise.all(promises);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() !== '');

    expect(lines.length).toBe(20);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.inputTokens).toBeGreaterThan(0);
      expect(parsed.model).toBe('gpt-4o');
    }
  });
});
