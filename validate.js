import fs from 'fs';
import path from 'path';

function validateTraceJSONL() {
  const filePath = path.join(process.cwd(), '.prompttrace', 'traces.jsonl');
  if (!fs.existsSync(filePath)) {
    console.error(`FAIL: File not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  if (content.startsWith('[') && content.endsWith(']')) {
    console.error('FAIL: File format is a JSON Array, not JSONL');
    process.exit(1);
  }

  let totalTraces = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      JSON.parse(line);
      totalTraces++;
    } catch (e) {
      console.error(`FAIL: Line ${i + 1} is malformed JSON: ${line}`);
      process.exit(1);
    }
  }

  console.log(`PASS: All lines are valid JSON. Total traces: ${totalTraces}`);
}

validateTraceJSONL();
