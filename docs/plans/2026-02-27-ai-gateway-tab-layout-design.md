# AI Gateway Tab Layout + Tool Connection Design

Date: 2026-02-27

## Overview

Add a tab layout to the full-width "Example Requests" card in `apps/web/src/pages/AIGateway.tsx`. The two tabs are **API** (existing content) and **Tool Connection** (new).

## Tab Structure

Use the existing Radix-based `Tabs` component from `apps/web/src/components/ui/tabs.tsx` with the `line` variant.

- **API tab** — existing provider/SDK selector + code snippet, no content changes
- **Tool Connection tab** — new content described below

## Tool Connection Tab

### Tool Selector Row

A row of tool buttons (icon + name) at the top of the tab. Kilo Code is the only active option initially. Future tools (OpenCode, etc.) render as dimmed "coming soon" chips. Selecting a tool updates the panel below.

### Two-Column Body

**Left column (~40%):** Numbered step list for the selected tool.

For Kilo Code:
1. Open Kilo Code → Settings (gear icon)
2. Set **API Provider** to `OpenAI Compatible`
3. Paste your gateway URL into **Base URL**
4. Paste your virtual key into **API Key**
5. Set **Model** (e.g. `openai/gpt-4o`)
6. Add Custom Header: `Content-Type: application/json`

Each step highlights (bold + accent color) in sync with the animation on the right.

**Right column (~60%):** Animated dark mock panel replicating the Kilo Code settings sidebar.

### Animation

- Background: `#1a1a2e` (matches code block style)
- Pure CSS `@keyframes` + React `useState` for step index tracking
- Each field animates with a typewriter effect (`max-width` from 0 to full using `steps()` easing)
- ~1.5s pause per field, full loop ~8–10s, then restarts
- Values used:
  - Base URL: `data.proxy_url` from gateway data
  - API Key: `{your_virtual_key}` placeholder
  - Model: `openai/gpt-4o`

### Mock Panel Fields (Kilo Code)

Renders a styled div tree mimicking the Kilo Code settings sidebar:
- Configuration Profile: `default (Active)`
- API Provider dropdown: `OpenAI Compatible`
- Base URL input (animated)
- API Key input (animated, masked with dots after fill)
- Model dropdown: `openai/gpt-4o`
- Custom Headers section: `Authorization` / `Bearer {your_virtual_key}`, `Content-Type` / `application/json`

## File Changes

- `apps/web/src/pages/AIGateway.tsx` — wrap the "Example Requests" section in `Tabs`, add `ToolConnectionTab` component inline

## Future Extensions

When adding OpenCode or other tools, add a new tool chip to the selector row and implement a corresponding mock panel + step list. The structure is designed to accommodate this with a `selectedTool` state pattern.
