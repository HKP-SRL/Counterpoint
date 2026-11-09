// RED stub (01-14 Task 2): replaced by the implementation in the GREEN commit.
import type { Hono } from 'hono';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface NeedsYouRoutesOptions {
  runtimes: HostRuntimes;
  home: string;
  approvals: ApprovalViews;
}

export function mountNeedsYouRoutes(_app: Hono, _options: NeedsYouRoutesOptions): void {}
