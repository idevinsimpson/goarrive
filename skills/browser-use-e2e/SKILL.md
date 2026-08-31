# Browser Use E2E Testing Skill

This skill provides instructions for AI agents on how to perform end-to-end (E2E) browser testing for the GoArrive platform using the Browser Use Cloud SDK.

## Overview

GoArrive uses [Browser Use](https://browser-use.com/) for automated, LLM-driven UI and UX testing. The Browser Use SDK allows agents to programmatically control a headless browser, navigate the GoArrive staging or production environments, interact with elements, and verify functionality.

## Authentication

The API key for Browser Use Cloud is required to initialize the SDK. It is read from the
environment and **must never be committed to this repository**.

- **Environment variable:** `BROWSER_USE_API_KEY`
- **Where to set it:** export it in your local shell / `.env` (both are gitignored), or supply it
  as a CI secret. Never paste the literal value into a file, a prompt, or a commit.

```bash
export BROWSER_USE_API_KEY="<your Browser Use Cloud key>"
```

> **Security notice — rotate the old key.** A live Browser Use Cloud API key was previously
> hardcoded in this file and committed to a **public** repository. Removing it from the current
> file does **not** remove it from git history, so it must be treated as **compromised**. Revoke
> and reissue that key in the Browser Use Cloud dashboard; do not reuse it. The replacement key
> belongs only in the environment variable above.

## Usage Instructions

When asked to perform browser-based E2E testing or verify UI/UX flows, follow these steps:

1. **Install the SDK:** Ensure the `browser-use-sdk` package is installed in your Python environment.
   ```bash
   pip install browser-use-sdk
   ```

2. **Initialize the Client:** Authenticate the `AsyncBrowserUse` client with the key from the
   environment. Never inline the literal key.
   ```python
   import os

   from browser_use_sdk.v3 import AsyncBrowserUse

   api_key = os.environ["BROWSER_USE_API_KEY"]  # raises if the env var is not set
   client = AsyncBrowserUse(api_key=api_key)
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
