import pytest
import asyncio
import os
import json
from prompttrace.storage import StorageEngine
from prompttrace.wrapper import trace_llm, trace_llm_async

class Message:
    content = "Test content"

class Choice:
    message = Message()

class Response:
    choices = [Choice()]
    class Usage:
        prompt_tokens = 10
        completion_tokens = 10
        total_tokens = 20
    usage = Usage()

class MockAsyncClient:
    class Chat:
        class Completions:
            async def create(self, **kwargs):
                return Response()
            
            # Need to add sync create for trace_llm if used
            def create_sync(self, **kwargs):
                return Response()
                
        completions = Completions()
    
    chat = Chat()
    
    # Mock AsyncOpenAI check
    def __class__(self):
        return "AsyncOpenAI"

@pytest.fixture(autouse=True)
def wipe_traces():
    target = os.path.join(os.getcwd(), '.prompttrace', 'traces.jsonl')
    if os.path.exists(target):
        os.remove(target)
    yield
    if os.path.exists(target):
        os.remove(target)

@pytest.mark.asyncio
async def test_concurrent_writes():
    client = MockAsyncClient()
    # explicitly mock the function so asyncio works
    client.chat.completions.create = client.chat.completions.create
    
    traced_client = trace_llm_async(client, config={"log": False, "store": "local"})

    tasks = []
    for i in range(20):
        tasks.append(traced_client.chat.completions.create(model="gpt-4", messages=[{"role": "user", "content": f"Test {i}"}]))
    
    await asyncio.gather(*tasks)

    target = os.path.join(os.getcwd(), '.prompttrace', 'traces.jsonl')
    assert os.path.exists(target)

    with open(target, 'r') as f:
        lines = f.readlines()
        
    assert len(lines) == 20
    
    for line in lines:
        parsed = json.loads(line)
        assert parsed.get("model") == "gpt-4"
        assert "inputTokens" in parsed
