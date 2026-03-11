# LLM.md - Hanzo Uni V2 Subgraph

## Overview
This subgraph dynamically tracks any pair created by the uniswap factory. It tracks of the current state of Uniswap contracts, and contains derived stats for things like historical data and USD prices

## Tech Stack
- **Language**: TypeScript/JavaScript

## Build & Run
```bash
pnpm install && pnpm build
pnpm test
```

## Structure
```
uni-v2-subgraph/
  LICENSE
  README.md
  abis/
  generated/
  package.json
  pnpm-lock.yaml
  schema.graphql
  src/
  subgraph.yaml
  tsconfig.json
  yarn.lock
```

## Key Files
- `README.md` -- Project documentation
- `package.json` -- Dependencies and scripts
