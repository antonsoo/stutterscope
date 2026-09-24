#!/usr/bin/env node
// Thin shim so `npx github:antonsoo/stutterscope summary <file>` works
// without a build step: Node's native TypeScript support (unflagged since
// Node 23.6) runs src/cli/index.ts directly.
import "../src/cli/index.ts";
