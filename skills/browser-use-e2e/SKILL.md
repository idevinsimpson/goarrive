# Browser Use E2E Testing Skill

This skill provides instructions for AI agents on how to perform end-to-end (E2E) browser testing for the GoArrive platform using the Browser Use Cloud SDK.

## Overview

GoArrive uses [Browser Use](https://browser-use.com/) for automated, LLM-driven UI and UX testing. The Browser Use SDK allows agents to programmatically control a headless browser, navigate the GoArrive staging or production environments, interact with elements, and verify functionality.

## Authentication

The API key for Browser Use Cloud is required to initialize the SDK.
- **API Key:** `bu_blfMah0ZzLlNSqFoUlcHOOQKJ2xxMB0h4J7qvgOh5NA`

## Usage Instructions

When asked to perform browser-based E2E testing or verify UI/UX flows, follow these steps:

1. **Install the SDK:** Ensure the `browser-use-sdk` package is installed in your Python environment.
   ```bash
   pip install browser-use-sdk
   ```

2. **Initialize the Client:** Use the provided API key to authenticate the `AsyncBrowserUse` client.
   ```python
   from browser_use_sdk.v3 import AsyncBrowserUse

   # Initialize with the GoArrive API Key
   client = AsyncBrowserUse(api_key="bu_blfMah0ZzLlNSqFoUlcHOOQKJ2xxMB0h4J7qvgOh5NA")
   ```

3. **Execute Test Tasks:** Pass natural language instructions to the `run()` method to execute the test.
   ```python
   import asyncio

   async def run_test():
       result = await client.run(
           "Go to https://goarrive--staging.web.app. "
           "Verify that the login page loads correctly. "
           "Check for the presence of the 'Email' and 'Password' fields."
       )
       print(result)

   asyncio.run(run_test())
   ```

## Best Practices for GoArrive E2E Testing

- **Target Staging First:** Always run E2E tests against the staging environment (`https://goarrive--staging.web.app`) before touching production (`https://goarrive.fit`).
- **Clear Instructions:** Provide the Browser Use agent with specific, step-by-step natural language instructions.
- **Verify Core Loops:** Focus testing on the Core Product Loop: Coach builds workout → Member plays workout → Member reflects → Coach reviews.
- **Role-Based Testing:** Ensure tests cover the distinct experiences of the three roles: `platformAdmin`, `coach`, and `member`.
- **Mobile Emulation:** When testing member-facing views, instruct the browser to emulate a mobile viewport if possible, as the member experience is mobile-first.
