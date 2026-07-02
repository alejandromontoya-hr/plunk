/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {WorkflowStep} from '@plunk/db';
import {
  Clock,
  ExternalLink,
  GitBranch,
  Hourglass,
  Lightbulb,
  Link,
  LogOut,
  Mail,
  Maximize2,
  Minimize2,
  Plus,
  Settings,
  Timer,
  Trash2,
  UserCog,
  Webhook,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import dagre from 'dagre';
import {type TranslateFn, useTranslation} from '../lib/i18n';
import {network} from '../lib/network';
import {toast} from 'sonner';
import {Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@plunk/ui';
import {WorkflowSchemas} from '@plunk/shared';

interface WorkflowBuilderProps {
  workflowId: string;
  steps: (WorkflowStep & {
    template?: {id: string; name: string} | null;
    outgoingTransitions: Array<{
      id: string;
      toStepId: string;
      condition: unknown;
      priority: number;
    }>;
    incomingTransitions: Array<{
      id: string;
      fromStepId: string;
      condition: unknown;
      priority: number;
    }>;
  })[];
  onUpdate: () => void;
}

const STEP_TYPE_ICONS = {
  TRIGGER: GitBranch,
  SEND_EMAIL: Mail,
  DELAY: Clock,
  WAIT_FOR_EVENT: Clock,
  CONDITION: GitBranch,
  EXIT: LogOut,
  WEBHOOK: Webhook,
  UPDATE_CONTACT: UserCog,
};

const STEP_TYPE_COLORS = {
  TRIGGER: '#9333ea',
  SEND_EMAIL: '#2563eb',
  DELAY: '#ea580c',
  WAIT_FOR_EVENT: '#ca8a04',
  CONDITION: '#9333ea',
  EXIT: '#dc2626',
  WEBHOOK: '#16a34a',
  UPDATE_CONTACT: '#4f46e5',
};

const STEP_TYPE_BG = {
  TRIGGER: '#f3e8ff',
  SEND_EMAIL: '#dbeafe',
  DELAY: '#ffedd5',
  WAIT_FOR_EVENT: '#fef3c7',
  CONDITION: '#f3e8ff',
  EXIT: '#fee2e2',
  WEBHOOK: '#dcfce7',
  UPDATE_CONTACT: '#e0e7ff',
};

// Multi-branch condition helpers
function getExpectedBranches(config: any): string[] {
  if (config?.mode === 'multi') {
    return [...(config.branches || []).map((b: any) => b.id), 'default'];
  }
  return ['yes', 'no'];
}

function getBranchLabel(config: any, branchId: string, t: TranslateFn): string {
  if (config?.mode === 'multi') {
    if (branchId === 'default') return t('workflowSteps.builder.branchDefault');
    const branch = config.branches?.find((b: any) => b.id === branchId);
    return branch?.name || branchId;
  }
  return branchId === 'yes' ? t('workflowSteps.builder.branchYes') : t('workflowSteps.builder.branchNo');
}

const BRANCH_COLORS = ['#16a34a', '#dc2626', '#2563eb', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#059669'];

function getBranchColor(config: any, branchId: string): string {
  if (config?.mode === 'multi') {
    if (branchId === 'default') return '#64748b';
    const idx = config.branches?.findIndex((b: any) => b.id === branchId) ?? 0;
    return BRANCH_COLORS[idx % BRANCH_COLORS.length]!;
  }
  return branchId === 'yes' ? '#16a34a' : '#dc2626';
}

// Dagre layout function
function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 280;
  const nodeHeight = 120;

  dagreGraph.setGraph({
    rankdir: 'TB',
    nodesep: 100,
    ranksep: 150,
    marginx: 50,
    marginy: 50,
  });

  nodes.forEach(node => {
    dagreGraph.setNode(node.id, {width: nodeWidth, height: nodeHeight});
  });

  edges.forEach(edge => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map(node => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  // Center "Add Step" nodes directly below their parent nodes
  // For condition nodes with multiple branches, let dagre handle horizontal spread
  const adjustedNodes = layoutedNodes.map(node => {
    if (node.type === 'addStep') {
      // Find the parent node (the source of the edge connecting to this add node)
      const parentEdge = edges.find(edge => edge.target === node.id);
      if (parentEdge) {
        const parentNode = layoutedNodes.find(n => n.id === parentEdge.source);
        if (parentNode) {
          // Check how many add-step siblings share this parent
          const siblingAddNodes = edges.filter(
            e => e.source === parentEdge.source && layoutedNodes.find(n => n.id === e.target && n.type === 'addStep'),
          );

          if (siblingAddNodes.length > 1) {
            // Multiple branches — let dagre's spread positioning stand, only keep y
            return node;
          }

          // Single add node — center below parent
          return {
            ...node,
            position: {
              x: parentNode.position.x + nodeWidth / 2 - 32, // 32 is half of the 64px (w-16) width of the add button
              y: node.position.y,
            },
          };
        }
      }
    }
    return node;
  });

  return {nodes: adjustedNodes, edges};
}

// Add Step Node - appears at the end of flow paths
function AddStepNode({data}: {data: {label: string; onClick?: () => void}}) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: '#94a3b8',
          width: 14,
          height: 14,
          border: '2px solid white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }}
      />

      <div className="cursor-pointer hover:scale-105 transition-transform" onClick={data.onClick}>
        <div className="w-16 h-16 rounded-full bg-neutral-100 border-2 border-dashed border-neutral-400 hover:border-neutral-600 hover:bg-white flex items-center justify-center transition-all">
          <Plus className="h-8 w-8 text-neutral-500 hover:text-neutral-700 transition-colors" />
        </div>
        {data.label && <div className="text-xs text-neutral-500 text-center mt-2 font-medium">{data.label}</div>}
      </div>
    </>
  );
}

// Custom node component with action buttons
function CustomNode({
  data,
}: {
  data: {
    label: string;
    type: string;
    stepId?: string;
    icon?: any;
    color?: string;
    bgColor?: string;
    onEdit?: () => void;
    onDelete?: () => void;
    template?: {id: string; name: string};
    config?: any;
  };
}) {
  const {t} = useTranslation();
  const Icon = data.icon;
  const color = data.color;
  const bgColor = data.bgColor;
  const [showActions, setShowActions] = useState(false);

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={{opacity: 0, cursor: 'default', pointerEvents: 'none'}}
      />

      <div
        className="px-5 py-4 rounded-xl border-2 bg-white shadow-sm hover:shadow-md transition-all relative group"
        style={{
          borderColor: color,
          minWidth: '280px',
          maxWidth: '280px',
        }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {/* Action buttons - shown on hover */}
        {showActions && data.type === 'TRIGGER' && (
          <div className="absolute -top-3 -right-3 flex gap-1.5 z-10">
            <Button
              onClick={e => {
                e.stopPropagation();
                data.onEdit?.();
              }}
              variant="outline"
              size="icon"
              className="h-7 w-7"
              title={t('workflowSteps.builder.editTriggerSettings')}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {showActions && data.type !== 'TRIGGER' && (
          <div className="absolute -top-3 -right-3 flex gap-1.5 z-10">
            <Button
              onClick={e => {
                e.stopPropagation();
                data.onEdit?.();
              }}
              variant="outline"
              size="icon"
              className="h-7 w-7"
              title={t('workflowSteps.builder.editStep')}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              onClick={e => {
                e.stopPropagation();
                data.onDelete?.();
              }}
              variant="outline"
              size="icon"
              className="h-7 w-7 hover:bg-red-50 hover:border-red-400"
              title={t('workflowSteps.builder.deleteStep')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{backgroundColor: bgColor}}
          >
            <Icon className="h-5 w-5" style={{color}} />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-neutral-900 text-sm leading-tight mb-1 break-words">{data.label}</h4>
            <span
              className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: bgColor,
                color,
              }}
            >
              {t(`workflowSteps.types.${data.type}.label`)}
            </span>
          </div>
        </div>

        {/* Details */}
        {data.template && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <a
              href={`/templates/${data.template.id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              className="nodrag flex items-center gap-2 text-xs text-neutral-600 hover:text-blue-600 hover:bg-blue-50 -mx-2 px-2 py-1 rounded transition-colors group/template"
              title={t('workflowSteps.builder.openTemplateNewTab')}
            >
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1">{data.template.name}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover/template:opacity-100 transition-opacity" />
            </a>
          </div>
        )}
        {data.type === 'DELAY' && data.config?.amount && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <Timer className="h-3 w-3" />
              <span>
                {t('workflowSteps.builder.waitDuration', {amount: data.config.amount, unit: data.config.unit})}
              </span>
            </div>
          </div>
        )}
        {data.type === 'CONDITION' && data.config && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <div className="text-xs text-neutral-600">
              <div className="flex items-center gap-1 mb-1">
                <GitBranch className="h-3 w-3" />
                <span className="font-mono text-[10px] truncate">
                  {/* Handle both legacy format {field, type} and new format (string) */}
                  {typeof data.config.field === 'object' && data.config.field !== null && 'field' in data.config.field
                    ? String(data.config.field.field)
                    : String(data.config.field)}
                </span>
              </div>
              {data.config.mode === 'multi' ? (
                <div className="text-[10px] text-neutral-500 ml-4">
                  {t(
                    (data.config.branches?.length || 0) === 1
                      ? 'workflowSteps.builder.branchCount'
                      : 'workflowSteps.builder.branchCount_plural',
                    {count: data.config.branches?.length || 0},
                  )}
                </div>
              ) : (
                <div className="text-[10px] text-neutral-500 ml-4">
                  {data.config.operator} &quot;{String(data.config.value)}&quot;
                </div>
              )}
            </div>
          </div>
        )}
        {data.type === 'WAIT_FOR_EVENT' && data.config?.eventName && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <Hourglass className="h-3 w-3" />
              <span className="truncate">{data.config.eventName}</span>
            </div>
          </div>
        )}
        {data.type === 'TRIGGER' && data.config?.eventName && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <Lightbulb className="h-3 w-3" />
              <span className="truncate">{data.config.eventName}</span>
            </div>
          </div>
        )}
        {data.type === 'WEBHOOK' && data.config?.url && (
          <div className="mt-3 pt-3 border-t border-neutral-100">
            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <Link className="h-3 w-3" />
              <span className="truncate text-[10px]">
                {data.config.method || 'POST'} {data.config.url}
              </span>
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{opacity: 0, cursor: 'default', pointerEvents: 'none'}}
      />
    </>
  );
}

const nodeTypes = {
  custom: CustomNode,
  addStep: AddStepNode,
};

// Step type options for adding new steps
const STEP_TYPE_OPTIONS = [
  {value: 'SEND_EMAIL', icon: Mail, color: STEP_TYPE_COLORS.SEND_EMAIL},
  {value: 'DELAY', icon: Clock, color: STEP_TYPE_COLORS.DELAY},
  {value: 'WAIT_FOR_EVENT', icon: Clock, color: STEP_TYPE_COLORS.WAIT_FOR_EVENT},
  {value: 'CONDITION', icon: GitBranch, color: STEP_TYPE_COLORS.CONDITION},
  {value: 'WEBHOOK', icon: Webhook, color: STEP_TYPE_COLORS.WEBHOOK},
  {value: 'UPDATE_CONTACT', icon: UserCog, color: STEP_TYPE_COLORS.UPDATE_CONTACT},
  {value: 'EXIT', icon: LogOut, color: STEP_TYPE_COLORS.EXIT},
];

export function WorkflowBuilder({workflowId, steps, onUpdate}: WorkflowBuilderProps) {
  const {t} = useTranslation();
  const [addStepContext, setAddStepContext] = useState<{
    fromStepId: string | null;
    branch?: string;
  } | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [stepToDelete, setStepToDelete] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'splice' | 'cascade'>('splice');
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  // Define handlers before they are used in useMemo
  const handleEditStep = useCallback(
    (stepId: string) => {
      // Check if this is a TRIGGER step
      const step = steps.find(s => s.id === stepId);

      if (step?.type === 'TRIGGER') {
        // For TRIGGER steps, open workflow settings instead
        const event = new CustomEvent('workflow-open-settings');
        window.dispatchEvent(event);
      } else {
        // For other steps, open step editor
        const event = new CustomEvent('workflow-edit-step', {detail: {stepId}});
        window.dispatchEvent(event);
      }
    },
    [steps],
  );

  const handleDeleteStepClick = useCallback(
    (stepId: string) => {
      const step = steps.find(s => s.id === stepId);
      const isCondition = step?.type === 'CONDITION';
      const hasChildren = (step?.outgoingTransitions?.length ?? 0) > 0;
      setDeleteMode(isCondition || !hasChildren ? 'cascade' : 'splice');
      setStepToDelete(stepId);
      setShowDeleteDialog(true);
    },
    [steps],
  );

  // Convert workflow steps to React Flow nodes

  const rawNodes: Node[] = useMemo(() => {
    if (steps.length === 0) return [];

    const nodes: Node[] = steps.map(step => {
      const Icon = STEP_TYPE_ICONS[step.type as keyof typeof STEP_TYPE_ICONS] || GitBranch;
      const color = STEP_TYPE_COLORS[step.type as keyof typeof STEP_TYPE_COLORS] || '#6b7280';
      const bgColor = STEP_TYPE_BG[step.type as keyof typeof STEP_TYPE_BG] || '#f3f4f6';

      return {
        id: step.id,
        type: 'custom',
        position: step.position ? (step.position as {x: number; y: number}) : {x: 0, y: 0},
        data: {
          label: step.name,
          type: step.type,
          icon: Icon,
          color,
          bgColor,
          template: step.template,
          config: step.config,
          onEdit: () => handleEditStep(step.id),
          onDelete: () => handleDeleteStepClick(step.id),
        },
      };
    });

    // Add "Add Step" nodes at the end of each flow path
    steps.forEach(step => {
      if (step.type === 'EXIT') return; // Exit steps can't have next steps

      if (step.type === 'CONDITION') {
        const expectedBranches = getExpectedBranches(step.config);

        expectedBranches.forEach(branchId => {
          const hasBranch = step.outgoingTransitions?.some(t => {
            const condition = t.condition;
            return condition && typeof condition === 'object' && 'branch' in condition && condition.branch === branchId;
          });

          if (!hasBranch) {
            nodes.push({
              id: `${step.id}-add-${branchId}`,
              type: 'addStep',
              position: {x: 0, y: 0},
              draggable: false,
              data: {
                label: getBranchLabel(step.config, branchId, t),
                onClick: () => setAddStepContext({fromStepId: step.id, branch: branchId}),
              },
            });
          }
        });
      } else {
        // For non-condition steps, add + node if no outgoing transitions
        if (!step.outgoingTransitions || step.outgoingTransitions.length === 0) {
          nodes.push({
            id: `${step.id}-add`,
            type: 'addStep',
            position: {x: 0, y: 0},
            draggable: false,
            data: {
              label: '',
              onClick: () => setAddStepContext({fromStepId: step.id}),
            },
          });
        }
      }
    });

    return nodes;
  }, [steps, handleEditStep, handleDeleteStepClick, t]);

  // Convert transitions to React Flow edges
  const rawEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];

    steps.forEach(step => {
      if (step.outgoingTransitions && step.outgoingTransitions.length > 0) {
        step.outgoingTransitions.forEach(transition => {
          const condition = transition.condition;
          const isConditional = condition && typeof condition === 'object' && 'branch' in condition;
          const branch =
            condition && typeof condition === 'object' && 'branch' in condition
              ? (condition.branch as string)
              : undefined;

          const branchColor = branch ? getBranchColor(step.config, branch) : '#94a3b8';
          const branchLabel = branch ? getBranchLabel(step.config, branch, t) : undefined;

          edges.push({
            id: transition.id,
            source: step.id,
            target: transition.toStepId,
            type: 'smoothstep',
            animated: false,
            label: isConditional ? branchLabel : undefined,
            labelStyle: {
              fill: isConditional ? branchColor : '#64748b',
              fontWeight: 600,
              fontSize: 12,
            },
            labelBgStyle: {
              fill: '#fff',
              fillOpacity: 0.95,
            },
            labelBgPadding: [8, 4] as [number, number],
            labelBgBorderRadius: 4,
            style: {
              stroke: '#94a3b8',
              strokeWidth: 2,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#94a3b8',
              width: 20,
              height: 20,
            },
          });
        });
      }

      // Add edges from steps to their "Add Step" nodes
      if (step.type === 'EXIT') return;

      if (step.type === 'CONDITION') {
        const expectedBranches = getExpectedBranches(step.config);

        expectedBranches.forEach(branchId => {
          const hasBranch = step.outgoingTransitions?.some(
            t =>
              t.condition &&
              typeof t.condition === 'object' &&
              'branch' in t.condition &&
              t.condition.branch === branchId,
          );

          if (!hasBranch) {
            const color = getBranchColor(step.config, branchId);
            const label = getBranchLabel(step.config, branchId, t);

            edges.push({
              id: `${step.id}-add-${branchId}-edge`,
              source: step.id,
              target: `${step.id}-add-${branchId}`,
              type: 'smoothstep',
              animated: false,
              label,
              labelStyle: {fill: color, fontWeight: 600, fontSize: 12},
              labelBgStyle: {fill: '#fff', fillOpacity: 0.95},
              labelBgPadding: [8, 4] as [number, number],
              labelBgBorderRadius: 4,
              style: {stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5'},
              markerEnd: {type: MarkerType.ArrowClosed, color: '#94a3b8', width: 20, height: 20},
            });
          }
        });
      } else {
        if (!step.outgoingTransitions || step.outgoingTransitions.length === 0) {
          edges.push({
            id: `${step.id}-add-edge`,
            source: step.id,
            target: `${step.id}-add`,
            type: 'smoothstep',
            animated: false,
            style: {stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5'},
            markerEnd: {type: MarkerType.ArrowClosed, color: '#94a3b8', width: 20, height: 20},
          });
        }
      }
    });

    return edges;
  }, [steps, t]);

  // Apply dagre layout
  const {nodes: layoutedNodes, edges: layoutedEdges} = useMemo(() => {
    if (rawNodes.length === 0) return {nodes: [], edges: []};
    return getLayoutedElements(rawNodes, rawEdges);
  }, [rawNodes, rawEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);


  // Update nodes/edges when layout changes
  useEffect(() => {
    setNodes(layoutedNodes);
  }, [layoutedNodes, setNodes]);

  useEffect(() => {
    setEdges(layoutedEdges);
  }, [layoutedEdges, setEdges]);

  // Handle creating a new step from the + node

  const handleCreateStep = useCallback(
    async (stepType: string) => {
      if (!addStepContext?.fromStepId) return;

      try {
        // Validate that this branch doesn't already have a transition
        const fromStep = steps.find(s => s.id === addStepContext.fromStepId);
        if (!fromStep) {
          toast.error(t('workflowSteps.builder.parentStepNotFound'));
          return;
        }

        // For CONDITION steps, check if the branch already exists
        if (fromStep.type === 'CONDITION' && addStepContext.branch) {
          const existingBranchTransition = fromStep.outgoingTransitions?.find(t => {
            const condition = t.condition;
            return (
              condition &&
              typeof condition === 'object' &&
              'branch' in condition &&
              condition.branch === addStepContext.branch
            );
          });
          if (existingBranchTransition) {
            toast.error(t('workflowSteps.builder.branchAlreadyConnected', {branch: addStepContext.branch}));
            return;
          }
        }

        // Create the new step (autoConnect: false because we manually create the transition with branch info)
        const newStep = await network.fetch<WorkflowStep, typeof WorkflowSchemas.addStep>(
          'POST',
          `/workflows/${workflowId}/steps`,
          {
            type: stepType as WorkflowStep['type'],
            name: t('workflowSteps.builder.newStepName', {type: t(`workflowSteps.types.${stepType}.label`)}),
            position: {x: 0, y: 0}, // Will be auto-positioned by dagre layout
            config: {},
            autoConnect: false, // We manually create transitions to preserve branch information
          },
        );

        const newStepId = newStep.id;

        // Create the transition with proper condition
        const condition = addStepContext.branch ? {branch: addStepContext.branch} : null;
        const expectedBranches = fromStep.type === 'CONDITION' ? getExpectedBranches(fromStep.config) : [];
        const branchIndex = addStepContext.branch ? expectedBranches.indexOf(addStepContext.branch) : -1;
        const priority = branchIndex >= 0 ? branchIndex : 0;

        await network.fetch<unknown, typeof WorkflowSchemas.createTransition>(
          'POST',
          `/workflows/${workflowId}/transitions`,
          {
            fromStepId: addStepContext.fromStepId,
            toStepId: newStepId,
            condition,
            priority,
          },
        );

        toast.success(t('workflowSteps.builder.stepAdded'));
        setAddStepContext(null);
        onUpdate();

        // Trigger edit dialog for the new step after a short delay
        setTimeout(() => {
          const event = new CustomEvent('workflow-edit-step', {detail: {stepId: newStepId}});
          window.dispatchEvent(event);
        }, 100);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('workflowSteps.builder.failedToAddStep'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addStepContext, workflowId, onUpdate, t],
  );

  // Get all steps that will be affected by deleting a step (the step itself + all downstream steps)
  const getAffectedSteps = useCallback(
    (stepId: string): typeof steps => {
      const affected = new Set<string>();
      const queue = [stepId];

      // BFS to find all downstream steps
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (affected.has(currentId)) continue;

        affected.add(currentId);

        const currentStep = steps.find(s => s.id === currentId);
        if (currentStep?.outgoingTransitions) {
          for (const transition of currentStep.outgoingTransitions) {
            if (!affected.has(transition.toStepId)) {
              queue.push(transition.toStepId);
            }
          }
        }
      }

      return steps.filter(s => affected.has(s.id));
    },
    [steps],
  );

  const handleDeleteStep = async () => {
    if (!stepToDelete) return;

    try {
      const url =
        deleteMode === 'splice'
          ? `/workflows/${workflowId}/steps/${stepToDelete}?splice=true`
          : `/workflows/${workflowId}/steps/${stepToDelete}`;

      await network.fetch('DELETE', url);

      if (deleteMode === 'cascade') {
        const affectedSteps = getAffectedSteps(stepToDelete);
        if (affectedSteps.length > 1) {
          toast.success(t('workflowSteps.builder.stepsDeleted', {count: affectedSteps.length}));
        } else {
          toast.success(t('workflowSteps.builder.stepDeleted'));
        }
      } else {
        toast.success(t('workflowSteps.builder.stepRemovedFromFlow'));
      }

      onUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workflowSteps.builder.failedToDeleteStep'));
    } finally {
      setStepToDelete(null);
    }
  };


  if (steps.length === 0) {
    return (
      <div className="bg-neutral-50 border-2 border-dashed border-neutral-300 rounded-lg p-12 text-center">
        <GitBranch className="h-16 w-16 text-neutral-400 mx-auto mb-4" />
        <p className="text-neutral-600 font-medium">{t('workflowSteps.builder.emptyTitle')}</p>
        <p className="text-sm text-neutral-500 mt-2">{t('workflowSteps.builder.emptySubtitle')}</p>
      </div>
    );
  }

  return (
    <>
      {isExpanded && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setIsExpanded(false)}
        />
      )}
      <div
        className={
          isExpanded
            ? 'fixed inset-[5%] z-50 bg-neutral-50 rounded-xl border border-neutral-200 shadow-2xl'
            : 'w-full h-[800px] bg-neutral-50 rounded-lg border border-neutral-200 shadow-inner relative'
        }
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{
            padding: 0.3,
            minZoom: 0.5,
            maxZoom: 1.2,
          }}
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          defaultEdgeOptions={{
            type: 'smoothstep',
          }}
          deleteKeyCode={null}
          proOptions={{hideAttribution: true}}
        >
          <Background color="#e5e7eb" gap={16} size={1} />
          <Controls
            showInteractive={false}
            className="bg-white border border-neutral-200 rounded-lg shadow-md"
          />
          <MiniMap
            nodeColor={node => {
              const step = steps.find(s => s.id === node.id);
              return step ? STEP_TYPE_COLORS[step.type as keyof typeof STEP_TYPE_COLORS] : '#6b7280';
            }}
            className="bg-white border border-neutral-200 rounded-lg shadow-md"
            maskColor="rgba(0, 0, 0, 0.05)"
          />
          <Panel
            position="top-left"
            className="bg-white px-4 py-2.5 rounded-lg shadow-md border border-neutral-200"
          >
            <div className="flex items-center gap-3">
              <GitBranch className="h-4 w-4 text-neutral-700" />
              <div className="text-sm">
                <span className="text-neutral-600">
                  {t(
                    steps.length === 1 ? 'workflowSteps.builder.stepCount' : 'workflowSteps.builder.stepCount_plural',
                    {count: steps.length},
                  )}
                </span>
                <span className="text-neutral-400 mx-2">·</span>
                <span className="text-neutral-600">
                  {t(
                    rawEdges.length === 1
                      ? 'workflowSteps.builder.connectionCount'
                      : 'workflowSteps.builder.connectionCount_plural',
                    {count: rawEdges.length},
                  )}
                </span>
              </div>
            </div>
          </Panel>
          <Panel position="top-right">
            <button
              onClick={() => setIsExpanded(e => !e)}
              className="bg-white border border-neutral-200 rounded-lg shadow-md p-2 hover:bg-neutral-50 transition-colors"
              title={isExpanded ? t('workflowSteps.builder.exitFullscreen') : t('workflowSteps.builder.expandFullscreen')}
            >
              {isExpanded ? (
                <Minimize2 className="h-4 w-4 text-neutral-600" />
              ) : (
                <Maximize2 className="h-4 w-4 text-neutral-600" />
              )}
            </button>
          </Panel>
{rawEdges.length === 0 && steps.length > 1 && (
            <Panel
              position="bottom-center"
              className="bg-white border border-neutral-200 px-4 py-2.5 rounded-lg shadow-sm"
            >
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <Lightbulb className="h-4 w-4" />
                <span>{t('workflowSteps.builder.connectHint')}</span>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Step type picker dialog */}
      <Dialog open={!!addStepContext} onOpenChange={open => !open && setAddStepContext(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('workflowSteps.builder.addStepTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            {STEP_TYPE_OPTIONS.map(option => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => handleCreateStep(option.value)}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50 transition-all group"
                >
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110"
                    style={{
                      backgroundColor: `${option.color}15`,
                    }}
                  >
                    <Icon className="h-6 w-6" style={{color: option.color}} />
                  </div>
                  <span className="text-sm font-medium text-neutral-900">
                    {t(`workflowSteps.types.${option.value}.label`)}
                  </span>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStepContext(null)}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stepToDelete &&
        (() => {
          const affectedSteps = getAffectedSteps(stepToDelete);
          const stepToDeleteData = steps.find(s => s.id === stepToDelete);
          const downstreamSteps = affectedSteps.filter(s => s.id !== stepToDelete);
          const isCondition = stepToDeleteData?.type === 'CONDITION';
          const hasChildren = downstreamSteps.length > 0;
          const canSplice = !isCondition && hasChildren;

          return (
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('workflowSteps.builder.removeTitle', {name: stepToDeleteData?.name ?? ''})}</DialogTitle>
                </DialogHeader>

                {canSplice ? (
                  <div className="space-y-3 py-1">
                    <p className="text-sm text-neutral-600">{t('workflowSteps.builder.removeQuestion')}</p>
                    <div className="space-y-2">
                      <button
                        onClick={() => setDeleteMode('splice')}
                        className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                          deleteMode === 'splice'
                            ? 'border-neutral-900 bg-neutral-50'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <p className="text-sm font-medium text-neutral-900">
                          {t('workflowSteps.builder.removeFromFlow')}
                        </p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {t('workflowSteps.builder.removeFromFlowDescription')}
                        </p>
                      </button>
                      <button
                        onClick={() => setDeleteMode('cascade')}
                        className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                          deleteMode === 'cascade'
                            ? 'border-red-500 bg-red-50'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <p className="text-sm font-medium text-neutral-900">
                          {t(
                            downstreamSteps.length === 1
                              ? 'workflowSteps.builder.deleteWithDownstream'
                              : 'workflowSteps.builder.deleteWithDownstream_plural',
                            {count: downstreamSteps.length},
                          )}
                        </p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {t('workflowSteps.builder.deleteWithDownstreamDescription')}
                        </p>
                      </button>
                    </div>
                  </div>
                ) : isCondition && hasChildren ? (
                  <div className="space-y-3 py-1">
                    <p className="text-sm text-neutral-600">
                      {t(
                        downstreamSteps.length === 1
                          ? 'workflowSteps.builder.conditionDeleteWarning'
                          : 'workflowSteps.builder.conditionDeleteWarning_plural',
                        {count: downstreamSteps.length},
                      )}
                    </p>
                    <ul className="list-disc list-inside text-sm text-neutral-600 max-h-32 overflow-y-auto bg-neutral-50 p-3 rounded border border-neutral-200">
                      {downstreamSteps.map(step => (
                        <li key={step.id}>
                          {step.name} ({t(`workflowSteps.types.${step.type}.label`)})
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm font-medium text-red-600">{t('workflowSteps.builder.cannotBeUndone')}</p>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-600 py-1">{t('workflowSteps.builder.confirmDeleteSingle')}</p>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant={deleteMode === 'cascade' || !canSplice ? 'destructive' : 'default'}
                    onClick={() => {
                      setShowDeleteDialog(false);
                      handleDeleteStep();
                    }}
                  >
                    {canSplice && deleteMode === 'splice'
                      ? t('workflowSteps.builder.removeFromFlow')
                      : hasChildren
                        ? t('workflowSteps.builder.deleteStepsButton', {count: affectedSteps.length})
                        : t('workflowSteps.builder.deleteStepButton')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        })()}
    </>
  );
}
