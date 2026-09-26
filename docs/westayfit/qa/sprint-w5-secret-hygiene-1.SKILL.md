# Browser Use E2E Testing Skill

This skill provides instructions for AI agents on how to perform end-to-end (E2E) browser testing for the GoArrive platform using the Browser Use Cloud SDK.

## Overview

GoArrive uses [Browser Use](https://browser-use.com/) for automated, LLM-driven UI and UX testing. The Browser Use SDK allows agents to programmatically control a headless browser, navigate the GoArrive staging or production environments, interact with elements, and verify functionality.

## Authentication

The API key for Browser Use Cloud is required to initialize the SDK.
- **API Key:** read from the `BROWSER_USE_API_KEY` environment variable (a local shell export or `.env`, both gitignored, or the runner's secret store). It must never be committed.

> **Security notice.** A Browser Use Cloud key was previously committed to this public repository in plaintext. Removing it from source does not revoke it, and it remains in git history. The account owner must revoke that key in the Browser Use Cloud dashboard and issue a replacement through the environment/secret path above. `.github/wsf-staging/tests/committed-secrets.test.mjs` refuses a literal key here.

## Usage Instructions

When asked to perform browser-based E2E testing or verify UI/UX flows, follow these steps:

1. **Install the SDK:** Ensure the `browser-use-sdk` package is installed in your Python environment.
   ```bash
   pip install browser-use-sdk
   ```

2. **Initialize the Client:** Authenticate the `AsyncBrowserUse` client with the key from the environment.
   ```python
   import os

   from browser_use_sdk.v3 import AsyncBrowserUse

   # The key comes from BROWSER_USE_API_KEY, never from this file
   client = AsyncBrowserUse(api_key=os.environ["BROWSER_USE_API_KEY"])  # never inline the literal key
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
