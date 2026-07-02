/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  IconSpinner,
  Switch,
} from '@plunk/ui';
import type {Workflow, WorkflowExecution, WorkflowStep, WorkflowTransition} from '@plunk/db';
import {DashboardLayout} from '../../components/DashboardLayout';
import {network} from '../../lib/network';
import {useTranslation} from '../../lib/i18n';
import {
  AlertTriangle,
  ArrowLeft,
  Info,
  Power,
  PowerOff,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import {NextSeo} from 'next-seo';
import {WorkflowBuilder} from '../../components/WorkflowBuilder';
import {EditStepDialog} from '../../components/workflow-steps';
import {ReactFlowProvider} from '@xyflow/react';
import {WorkflowSchemas} from '@plunk/shared';
import dayjs from 'dayjs';

interface WorkflowWithDetails extends Workflow {
  steps: (WorkflowStep & {
    template?: {id: string; name: string} | null;
    outgoingTransitions: WorkflowTransition[];
    incomingTransitions: WorkflowTransition[];
  })[];
}

interface PaginatedExecutions {
  executions: (WorkflowExecution & {
    contact: {id: string; email: string};
    currentStep?: {id: string; name: string; type: string} | null;
  })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function WorkflowEditorPage() {
  const {t} = useTranslation();
  const router = useRouter();
  const {id} = router.query;
  const [activeTab, setActiveTab] = useState<'builder' | 'executions'>('builder');

  type WorkflowDialog =
    | {type: 'none'}
    | {type: 'settings'}
    | {type: 'cancelAll'; cancelling: boolean}
    | {type: 'cancelOne'; executionId: string; cancelling: boolean}
    | {type: 'editStep'; step: WorkflowStep}
    | {type: 'delete'};

  const [dialog, setDialog] = useState<WorkflowDialog>({type: 'none'});

  const {data: workflow, mutate} = useSWR<WorkflowWithDetails>(id ? `/workflows/${id}` : null, {
    revalidateOnFocus: false,
  });

  const {data: executionsData} = useSWR<PaginatedExecutions>(
    id && activeTab === 'executions' ? `/workflows/${id}/executions?page=1&pageSize=10` : null,
    {revalidateOnFocus: false},
  );

  // Always fetch a summary of active executions to show warnings (regardless of enabled status)
  const {data: activeExecutionsData} = useSWR<PaginatedExecutions>(
    id ? `/workflows/${id}/executions?page=1&pageSize=1&status=RUNNING` : null,
    {revalidateOnFocus: false, refreshInterval: 10000},
  );

  const {data: waitingExecutionsData} = useSWR<PaginatedExecutions>(
    id ? `/workflows/${id}/executions?page=1&pageSize=1&status=WAITING` : null,
    {revalidateOnFocus: false, refreshInterval: 10000},
  );

  // Check for active executions
  const activeExecutionsCount = (activeExecutionsData?.total || 0) + (waitingExecutionsData?.total || 0);

  // Handler for cancelling a single execution
  const handleCancelExecution = async (executionId: string) => {
    setDialog({type: 'cancelOne', executionId, cancelling: true});
    try {
      await network.fetch('DELETE', `/workflows/${id}/executions/${executionId}`);
      toast.success(t('workflows.toast.executionCancelSuccess'));
      setDialog({type: 'none'});
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workflows.toast.executionCancelError'));
      setDialog({type: 'cancelOne', executionId, cancelling: false});
    }
  };

  // Handler for cancelling all executions
  const handleCancelAllExecutions = async () => {
    setDialog(d => (d.type === 'cancelAll' ? {...d, cancelling: true} : d));
    try {
      const result = await network.fetch<{cancelled: number}>('POST', `/workflows/${id}/executions/cancel-all`);
      toast.success(t('workflows.toast.cancelAllSuccess', {count: result.cancelled}));
      setDialog({type: 'none'});
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workflows.toast.cancelAllError'));
      setDialog(d => (d.type === 'cancelAll' ? {...d, cancelling: false} : d));
    }
  };

  // Validate workflow configuration
  const validateWorkflow = (workflow: WorkflowWithDetails): {valid: boolean; errors: string[]} => {
    const errors: string[] = [];

    // Check if there are any steps
    if (workflow.steps.length === 0) {
      errors.push(t('workflows.editor.validation.noSteps'));
      return {valid: false, errors};
    }

    // Validate each step
    workflow.steps.forEach(step => {
      const config = step.config && typeof step.config === 'object' && !Array.isArray(step.config) ? step.config : {};

      switch (step.type) {
        case 'SEND_EMAIL':
          if (!step.templateId) {
            errors.push(t('workflows.editor.validation.missingTemplate', {name: step.name}));
          }
          break;

        case 'DELAY':
          if (!config.amount || !config.unit) {
            errors.push(t('workflows.editor.validation.missingDelay', {name: step.name}));
          }
          break;

        case 'CONDITION':
          if (config.mode === 'multi') {
            // Multi-branch validation
            if (!config.field) {
              errors.push(t('workflows.editor.validation.missingConditionField', {name: step.name}));
            }
            if (!Array.isArray(config.branches) || config.branches.length === 0) {
              errors.push(t('workflows.editor.validation.needsBranch', {name: step.name}));
            }
          } else {
            // Extract field name from both legacy format (object) and new format (string)
            let fieldValue = '';
            if (config.field) {
              if (typeof config.field === 'object' && config.field !== null && 'field' in config.field) {
                fieldValue = String(config.field.field || '');
              } else {
                fieldValue = String(config.field);
              }
            }

            if (!fieldValue || !config.operator) {
              errors.push(t('workflows.editor.validation.missingConditionConfig', {name: step.name}));
            }
            // Check if value is required for this operator
            const operatorNeedsValue = !['exists', 'notExists'].includes(String(config.operator || ''));
            if (operatorNeedsValue && (config.value === undefined || config.value === null || config.value === '')) {
              errors.push(t('workflows.editor.validation.missingConditionValue', {name: step.name}));
            }
          }
          break;

        case 'WAIT_FOR_EVENT':
          if (!config.eventName) {
            errors.push(t('workflows.editor.validation.missingEventName', {name: step.name}));
          }
          break;

        case 'WEBHOOK':
          if (!config.url) {
            errors.push(t('workflows.editor.validation.missingWebhookUrl', {name: step.name}));
          }
          break;

        case 'UPDATE_CONTACT': {
          const hasUpdates =
            config.updates && typeof config.updates === 'object' && Object.keys(config.updates).length > 0;
          const hasSubscriptionAction =
            typeof config.subscriptionAction === 'string' &&
            config.subscriptionAction !== 'none' &&
            config.subscriptionAction !== '';
          if (!hasUpdates && !hasSubscriptionAction) {
            errors.push(t('workflows.editor.validation.missingContactUpdates', {name: step.name}));
          }
          break;
        }
      }
    });

    // Check for orphaned steps (steps with no incoming or outgoing transitions, except TRIGGER and EXIT)
    const triggerSteps = workflow.steps.filter(s => s.type === 'TRIGGER');

    workflow.steps.forEach(step => {
      if (step.type !== 'TRIGGER' && step.type !== 'EXIT') {
        const hasIncoming = step.incomingTransitions && step.incomingTransitions.length > 0;
        const hasOutgoing = step.outgoingTransitions && step.outgoingTransitions.length > 0;

        if (!hasIncoming && !hasOutgoing) {
          errors.push(t('workflows.editor.validation.notConnected', {name: step.name}));
        }
      }
    });

    // Check if there's a TRIGGER step
    if (triggerSteps.length === 0) {
      errors.push(t('workflows.editor.validation.noTrigger'));
    }

    // Check for CONDITION steps that don't have all required branches connected
    workflow.steps.forEach(step => {
      if (step.type === 'CONDITION' && step.outgoingTransitions) {
        const config = step.config && typeof step.config === 'object' && !Array.isArray(step.config) ? step.config : {};

        // Determine expected branches based on mode
        let expectedBranches: string[];
        if ((config as any).mode === 'multi' && Array.isArray((config as any).branches)) {
          expectedBranches = [...(config as any).branches.map((b: any) => b.id), 'default'];
        } else {
          expectedBranches = ['yes', 'no'];
        }

        const missingBranches = expectedBranches.filter(branchId => {
          return !step.outgoingTransitions.some(t => {
            const condition = t.condition;
            return condition && typeof condition === 'object' && 'branch' in condition && condition.branch === branchId;
          });
        });

        if (missingBranches.length > 0) {
          if ((config as any).mode === 'multi') {
            const branchNames = missingBranches.map(id => {
              if (id === 'default') return t('workflows.editor.validation.defaultBranch');
              const branch = (config as any).branches?.find((b: any) => b.id === id);
              return branch?.name || id;
            });
            errors.push(
              t('workflows.editor.validation.missingBranchConnections', {
                name: step.name,
                branches: branchNames.join(', '),
              }),
            );
          } else {
            errors.push(t('workflows.editor.validation.missingYesNoBranches', {name: step.name}));
          }
        }
      }
    });

    return {valid: errors.length === 0, errors};
  };

  const handleToggleEnabled = async () => {
    if (!workflow) return;

    // If trying to enable, validate first
    if (!workflow.enabled) {
      const validation = validateWorkflow(workflow);
      if (!validation.valid) {
        toast.error(
          <div>
            <div className="font-semibold mb-1">{t('workflows.editor.validation.cannotEnableTitle')}</div>
            <ul className="list-disc list-inside text-sm">
              {validation.errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>,
          {duration: 8000},
        );
        return;
      }
    }

    try {
      await network.fetch<Workflow, typeof WorkflowSchemas.update>('PATCH', `/workflows/${id}`, {
        enabled: !workflow.enabled,
      });
      toast.success(!workflow.enabled ? t('workflows.toast.enabledSuccess') : t('workflows.toast.disabledSuccess'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workflows.toast.toggleError'));
    }
  };

  const handleUpdateSettings = async (data: {
    name: string;
    description?: string;
    allowReentry?: boolean;
    triggerConfig?: {eventName: string};
  }) => {
    try {
      await network.fetch<Workflow, typeof WorkflowSchemas.update>('PATCH', `/workflows/${id}`, data);
      toast.success(t('workflows.toast.updateSuccess'));
      void mutate();
      setDialog({type: 'none'});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workflows.toast.updateError'));
    }
  };

  const handleDelete = async () => {
    try {
      await network.fetch('DELETE', `/workflows/${id}`);
      toast.success(t('workflows.toast.deleteSuccess'));
      void router.push('/workflows');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workflows.toast.deleteError'));
    }
  };

  // Listen for edit step events from the WorkflowBuilder
  useEffect(() => {
    const handleEditStepEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{stepId?: string}>;
      const stepId = customEvent.detail?.stepId;
      if (stepId && workflow) {
        const step = workflow.steps.find(s => s.id === stepId);
        if (step) {
          setDialog({type: 'editStep', step});
        }
      }
    };

    const handleOpenSettingsEvent = () => {
      setDialog({type: 'settings'});
    };

    window.addEventListener('workflow-edit-step', handleEditStepEvent);
    window.addEventListener('workflow-open-settings', handleOpenSettingsEvent);
    return () => {
      window.removeEventListener('workflow-edit-step', handleEditStepEvent);
      window.removeEventListener('workflow-open-settings', handleOpenSettingsEvent);
    };
  }, [workflow]);

  if (!workflow) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <IconSpinner />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <NextSeo title={workflow.name} />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 sm:gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link href="/workflows" aria-label={t('workflows.editor.back')}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 truncate">{workflow.name}</h1>
              <span
                className={`inline-flex items-center px-2 sm:px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                  workflow.enabled ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-800'
                }`}
              >
                {workflow.enabled ? (
                  <>
                    <Power className="h-3 w-3 sm:mr-1" />
                    <span className="hidden sm:inline">{t('workflows.status.active')}</span>
                  </>
                ) : (
                  <>
                    <PowerOff className="h-3 w-3 sm:mr-1" />
                    <span className="hidden sm:inline">{t('workflows.status.disabled')}</span>
                  </>
                )}
              </span>
            </div>
            {workflow.description && (
              <p className="text-neutral-500 mt-1 text-sm sm:text-base">{workflow.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button variant="ghost" size="icon" onClick={() => setDialog({type: 'settings'})} aria-label={t('workflows.editor.settings')}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDialog({type: 'delete'})}
              aria-label={t('workflows.editor.deleteWorkflow')}
              className="text-neutral-400 hover:text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <div className="h-5 w-px bg-neutral-200 mx-1" />
            <Button variant={workflow.enabled ? 'outline' : 'default'} onClick={handleToggleEnabled}>
              {workflow.enabled ? (
                <>
                  <PowerOff className="h-4 w-4" />
                  {t('workflows.editor.disable')}
                </>
              ) : (
                <>
                  <Power className="h-4 w-4" />
                  {t('workflows.editor.enable')}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Active Executions Warning Banner */}
        {activeExecutionsCount > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>
              {workflow.enabled
                ? t('workflows.editor.activeExecutionsBanner.titleEnabled')
                : t('workflows.editor.activeExecutionsBanner.titleDisabled')}
            </AlertTitle>
            <AlertDescription>
              <p>
                {activeExecutionsCount === 1
                  ? t('workflows.editor.activeExecutionsBanner.intro', {count: activeExecutionsCount})
                  : t('workflows.editor.activeExecutionsBanner.introPlural', {count: activeExecutionsCount})}{' '}
                {!workflow.enabled && `${t('workflows.editor.activeExecutionsBanner.disabledNote')} `}
                {t('workflows.editor.activeExecutionsBanner.protectIntro')}
              </p>
              <ul className="list-disc list-inside space-y-1 mt-2">
                <li>{t('workflows.editor.activeExecutionsBanner.cannotDeleteSteps')}</li>
                <li>{t('workflows.editor.activeExecutionsBanner.cannotModifyConfig')}</li>
                <li>{t('workflows.editor.activeExecutionsBanner.cannotChangeTrigger')}</li>
              </ul>
              <p className="mt-2">
                {t('workflows.editor.activeExecutionsBanner.outro')}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Validation Warning Banner / Ready-to-enable Banner */}
        {!workflow.enabled &&
          (() => {
            const validation = validateWorkflow(workflow);
            if (!validation.valid) {
              return (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t('workflows.editor.validationBanner.title')}</AlertTitle>
                  <AlertDescription>
                    <p className="mb-2">{t('workflows.editor.validationBanner.intro')}</p>
                    <ul className="list-disc list-inside space-y-1">
                      {validation.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              );
            }
            if (workflow.steps.length > 0) {
              return (
                <Alert>
                  <Power className="h-4 w-4" />
                  <AlertTitle>{t('workflows.editor.disabledBanner.title')}</AlertTitle>
                  <AlertDescription className="flex items-center justify-between gap-4">
                    <span>{t('workflows.editor.disabledBanner.description')}</span>
                    <Button size="sm" onClick={handleToggleEnabled} className="shrink-0">
                      <Power className="h-3.5 w-3.5" />
                      {t('workflows.editor.disabledBanner.enable')}
                    </Button>
                  </AlertDescription>
                </Alert>
              );
            }
            return null;
          })()}

        {/* Tabs */}
        <div className="border-b border-neutral-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('builder')}
              className={`py-2 px-1 border-b-2 font-medium text-sm rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                activeTab === 'builder'
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              {t('workflows.editor.tabs.builder')}
            </button>
            <button
              onClick={() => setActiveTab('executions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                activeTab === 'executions'
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              {t('workflows.editor.tabs.executions')}
            </button>
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'builder' ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('workflows.editor.builder.title')}</CardTitle>
              <CardDescription>
                {t('workflows.editor.builder.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ReactFlowProvider>
                <WorkflowBuilder workflowId={id as string} steps={workflow.steps} onUpdate={() => mutate()} />
              </ReactFlowProvider>
            </CardContent>
          </Card>
        ) : activeTab === 'executions' ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t('workflows.editor.executions.title')}</CardTitle>
                  <CardDescription>{t('workflows.editor.executions.description')}</CardDescription>
                </div>
                {activeExecutionsCount > 0 && (
                  <Button variant="outline" onClick={() => setDialog({type: 'cancelAll', cancelling: false})}>
                    {t('workflows.editor.executions.cancelAllActive', {count: activeExecutionsCount})}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!executionsData?.executions.length ? (
                <EmptyState
                  icon={Users}
                  title={t('workflows.editor.executions.emptyTitle')}
                  description={t('workflows.editor.executions.emptyDescription')}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-neutral-50 border-b border-neutral-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {t('workflows.editor.executions.columns.contact')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {t('workflows.editor.executions.columns.status')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {t('workflows.editor.executions.columns.currentStep')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {t('workflows.editor.executions.columns.started')}
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {t('workflows.editor.executions.columns.actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-neutral-200">
                      {executionsData.executions.map(execution => (
                        <tr key={execution.id} className="hover:bg-neutral-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900">
                            {execution.contact.email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge
                              variant={
                                execution.status === 'COMPLETED'
                                  ? 'success'
                                  : execution.status === 'FAILED'
                                    ? 'destructive'
                                    : execution.status === 'WAITING'
                                      ? 'warning'
                                      : execution.status === 'RUNNING'
                                        ? 'default'
                                        : 'neutral'
                              }
                            >
                              {t(`workflows.status.${execution.status}`)}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                            {execution.currentStep?.name ?? '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                            <div className="group relative inline-block cursor-help">
                              {dayjs(execution.startedAt).fromNow()}
                              <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-1/2 transform -translate-x-1/2 mb-1 whitespace-nowrap">
                                {dayjs(execution.startedAt).format('DD MMMM YYYY, hh:mm')}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            {(execution.status === 'RUNNING' || execution.status === 'WAITING') && (
                              <Button
                                variant="destructiveGhost"
                                size="sm"
                                onClick={() => setDialog({type: 'cancelOne', executionId: execution.id, cancelling: false})}
                                disabled={dialog.type === 'cancelOne' && dialog.cancelling}
                              >
                                {t('workflows.editor.executions.cancel')}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Dialogs */}
      {workflow && (
        <>
          <SettingsDialog
            workflow={workflow}
            open={dialog.type === 'settings'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onSave={handleUpdateSettings}
          />
          {dialog.type === 'editStep' && (
            <EditStepDialog
              step={dialog.step}
              workflowId={id as string}
              open={true}
              onOpenChange={open => !open && setDialog({type: 'none'})}
              onSuccess={() => mutate()}
            />
          )}

          {/* Cancel Single Execution Confirmation */}
          <ConfirmDialog
            open={dialog.type === 'cancelOne'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onConfirm={() => {
              if (dialog.type === 'cancelOne') {
                return handleCancelExecution(dialog.executionId);
              }
            }}
            title={t('workflows.editor.cancelOneDialog.title')}
            description={
              dialog.type === 'cancelOne' && executionsData?.executions ? (
                <div className="space-y-2">
                  <p>
                    {t('workflows.editor.cancelOneDialog.descriptionIntro', {
                      contact:
                        executionsData.executions.find(e => e.id === dialog.executionId)?.contact.email ||
                        t('workflows.editor.cancelOneDialog.thisContact'),
                    })}
                  </p>
                  <p className="text-sm text-neutral-600">
                    {t('workflows.editor.cancelOneDialog.descriptionNote')}
                  </p>
                </div>
              ) : (
                t('workflows.editor.cancelOneDialog.descriptionFallback')
              )
            }
            confirmText={t('workflows.editor.cancelOneDialog.confirm')}
            cancelText={t('workflows.editor.cancelOneDialog.keepRunning')}
            variant="destructive"
            status={dialog.type === 'cancelOne' && dialog.cancelling ? 'loading' : 'idle'}
          />

          {/* Cancel All Executions Confirmation */}
          <ConfirmDialog
            open={dialog.type === 'cancelAll'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onConfirm={handleCancelAllExecutions}
            title={t('workflows.editor.cancelAllDialog.title')}
            description={
              <div className="space-y-2">
                <p>
                  {activeExecutionsCount === 1
                    ? t('workflows.editor.cancelAllDialog.descriptionIntro', {count: activeExecutionsCount})
                    : t('workflows.editor.cancelAllDialog.descriptionIntroPlural', {count: activeExecutionsCount})}
                </p>
                <p className="text-sm text-neutral-600">
                  {t('workflows.editor.cancelAllDialog.descriptionNote')}
                </p>
              </div>
            }
            confirmText={
              activeExecutionsCount === 1
                ? t('workflows.editor.cancelAllDialog.confirm', {count: activeExecutionsCount})
                : t('workflows.editor.cancelAllDialog.confirmPlural', {count: activeExecutionsCount})
            }
            cancelText={t('workflows.editor.cancelAllDialog.keepRunning')}
            variant="destructive"
            status={dialog.type === 'cancelAll' && dialog.cancelling ? 'loading' : 'idle'}
          />

          {/* Delete Workflow Confirmation */}
          <ConfirmDialog
            open={dialog.type === 'delete'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onConfirm={handleDelete}
            title={t('workflows.editor.deleteDialog.title')}
            description={t('workflows.editor.deleteDialog.description')}
            confirmText={t('workflows.editor.deleteDialog.confirm')}
            variant="destructive"
          />
        </>
      )}
    </DashboardLayout>
  );
}

// Settings Dialog Component
interface SettingsDialogProps {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    name: string;
    description?: string;
    allowReentry?: boolean;
    triggerConfig?: {eventName: string};
  }) => Promise<void>;
}

function SettingsDialog({workflow, open, onOpenChange, onSave}: SettingsDialogProps) {
  const {t} = useTranslation();
  const triggerConfig = workflow.triggerConfig as {eventName?: string} | null;
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? '');
  const [allowReentry, setAllowReentry] = useState(workflow.allowReentry ?? false);
  const [eventName, setEventName] = useState(triggerConfig?.eventName ?? '');
  const [eventPopoverOpen, setEventPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync state when workflow changes or dialog opens
  useEffect(() => {
    if (open) {
      setName(workflow.name);
      setDescription(workflow.description ?? '');
      setAllowReentry(workflow.allowReentry ?? false);
      const config = workflow.triggerConfig as {eventName?: string} | null;
      setEventName(config?.eventName ?? '');
    }
  }, [open, workflow]);

  // Fetch available event names
  const {data: eventNamesData} = useSWR<{eventNames: string[]}>(open ? '/events/names' : null, {
    revalidateOnFocus: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await onSave({
        name,
        description: description || undefined,
        allowReentry,
        triggerConfig: eventName.trim() ? {eventName: eventName.trim()} : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workflows.editor.settings.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">{t('workflows.editor.settings.nameLabel')}</Label>
            <Input id="name" type="text" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div>
            <Label htmlFor="description">{t('workflows.editor.settings.descriptionLabel')}</Label>
            <textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="eventName">{t('workflows.editor.settings.triggerEventLabel')}</Label>
            <div className="relative">
              <Input
                id="eventName"
                type="text"
                value={eventName}
                onChange={e => {
                  setEventName(e.target.value);
                  setEventPopoverOpen(true);
                }}
                onFocus={() => setEventPopoverOpen(true)}
                onBlur={() => {
                  setTimeout(() => setEventPopoverOpen(false), 150);
                }}
                placeholder={t('workflows.editor.settings.triggerEventPlaceholder')}
                required
                autoComplete="off"
              />
              {eventPopoverOpen && ((eventNamesData?.eventNames?.length ?? 0) > 0 || eventName?.trim()) && (
                <div className="absolute z-50 w-full mt-1 rounded-md border border-neutral-200 bg-white shadow-md">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        {eventNamesData?.eventNames
                          ?.filter(n => !eventName || n.toLowerCase().includes(eventName.toLowerCase()))
                          .map(n => (
                            <CommandItem key={n} value={n} onSelect={() => { setEventName(n); setEventPopoverOpen(false); }}>
                              {n}
                            </CommandItem>
                          ))}
                        {eventName?.trim() && !eventNamesData?.eventNames?.some(n => n === eventName.trim()) && (
                          <CommandItem
                            key="__custom__"
                            value={eventName.trim()}
                            onSelect={() => { setEventName(eventName.trim()); setEventPopoverOpen(false); }}
                          >
                            {t('workflows.editor.settings.useCustomEvent', {value: eventName.trim()})}
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </div>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              {t('workflows.editor.settings.triggerEventHint')}
            </p>
          </div>

          <div className="flex items-start gap-3 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
            <Switch id="allowReentry" checked={allowReentry} onCheckedChange={setAllowReentry} />
            <div className="flex-1">
              <Label htmlFor="allowReentry" className="font-medium cursor-pointer">
                {t('workflows.editor.settings.allowReentryLabel')}
              </Label>
              <p className="text-xs text-neutral-500 mt-1">
                {t('workflows.editor.settings.allowReentryHint')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('workflows.editor.settings.submitting') : t('workflows.editor.settings.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

