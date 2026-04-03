import asyncio
from openai import AsyncOpenAI
from prompttrace import trace_llm

async def main():
    print("Testing Prompttrace Python SDK with AsyncOpenAI...")
    # Initialize real OpenAI client (or mock API key)
    client = AsyncOpenAI(api_key="sk-fake")
    
    # Mock network call for the demo to avoid charging the user
    async def mock_create(**kwargs):
        class MockChoiceMessage:
            content = "This is a mocked API response!"
        class MockChoice:
            message = MockChoiceMessage()
        class MockUsage:
            prompt_tokens = None
            completion_tokens = 15
            total_tokens = None
        class MockResponse:
            id = "chatcmpl-mock-python"
            choices = [MockChoice()]
            usage = MockUsage()
        return MockResponse()
        
    client.chat.completions.create = mock_create

    # Wrap the client
    client = trace_llm(client, {"log": True})

    instructions = "You are a busy sales agent working for ComplAI. " * 50

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": instructions},
                {"role": "user", "content": "Write a concise cold email"}
            ]
        )
        print("✅ Request complete! Traces logged.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
