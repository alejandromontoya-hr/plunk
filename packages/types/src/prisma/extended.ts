/**
 * Extended Prisma types
 * Types that extend Prisma models with additional relations or computed fields
 */

import type {
  Workflow,
  WorkflowExecution,
  WorkflowStep,
  WorkflowStepExecution,
  WorkflowTransition,
  Template,
  Contact,
  Prisma,
} from '@plunk/db';

/**
 * Workflow with all steps, transitions, and template details
 * Used for workflow editor and detailed workflow views
 */
export interface WorkflowWithDetails extends Workflow {
  steps: Array<
    WorkflowStep & {
      template?: {id: string; name: string} | null;
      outgoingTransitions: WorkflowTransition[];
      incomingTransitions: WorkflowTransition[];
    }
  >;
}

/**
 * Workflow execution with full context
 * Used for execution details and monitoring
 */
export interface WorkflowExecutionWithDetails extends WorkflowExecution {
  workflow: Workflow;
  contact: {id: string; email: string};
  currentStep?: WorkflowStep | null;
  stepExecutions: WorkflowStepExecution[];
}

/**
 * Workflow execution with all relations loaded
 * Used internally by workflow execution engine
 */
export type WorkflowExecutionWithRelations = WorkflowExecution & {
  contact: Contact;
  workflow: Workflow;
};

/**
 * Workflow step with optional template
 * Used by step execution logic
 */
export type WorkflowStepWithTemplate = WorkflowStep & {
  template?: Template | null;
};

/**
 * Workflow step with outgoing transitions loaded
 * Used for flow control and navigation
 */
export type WorkflowStepWithTransitions = WorkflowStep & {
  outgoingTransitions?: Array<{
    id: string;
    condition: Prisma.JsonValue;
    priority: number;
    toStep: WorkflowStep;
  }>;
};

/**
 * Step configuration (JSON value)
 * Type-safe alias for workflow step config
 */
export type StepConfig = Prisma.JsonValue;

/**
 * Step execution result
 * Generic key-value result from step execution
 */
export type StepResult = Record<string, unknown>;

/**
 * A topic paired with a contact's effective subscription status.
 * Mirrors the API shape returned by TopicService.getContactSubscriptions.
 */
export interface TopicSubscriptionSummary {
  topic: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    transactional: boolean;
    position: number;
  };
  status: 'SUBSCRIBED' | 'UNSUBSCRIBED';
}

/**
 * Contact enriched with its per-topic subscription summary, as returned by the
 * contacts list endpoint (the topic chips shown in the table).
 */
export interface ContactWithSubscriptions extends Contact {
  subscriptions: TopicSubscriptionSummary[];
}

/**
 * Contact enriched with send activity, as returned by the segment results table.
 * `lastSentAt` is the most recent email sent to the contact (ISO string) or null
 * if the contact has never been emailed. The "days since" figure is derived on the
 * client from this value.
 */
export interface ContactWithActivity extends Contact {
  lastSentAt: string | null;
}
