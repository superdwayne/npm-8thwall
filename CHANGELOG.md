# Changelog

All notable changes to this repository will be documented in this file.

## v1.0.1 — 2025-09-27

Adds an n8n Router node and publishes package version 1.0.1.

- New node: “8th Wall MCP Router” that maps free‑text requests into tool + args items (e.g., scaffold, start dev server, download/add model, set background color, add primitives/lights, environment HDR, OrbitControls/Grid/Floor).
- Works with the “8th Wall MCP Tool” node via expressions: `{{$json.tool}}`, `{{$json.args}}`.

## v1.0.0 — 2025-09-27

Initial n8n package scaffold and release workflow.

- Package: `n8n-nodes-8thwall` with a flexible node to invoke any MCP HTTP bridge tool.
- Credentials with connectivity test; uses n8n httpRequest helper; continueOnFail support.
- GitHub Actions workflow to draft releases on tag push.

