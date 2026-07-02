import {Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label} from '@plunk/ui';
import type {WorkflowStep} from '@plunk/db';
import {WorkflowSchemas} from '@plunk/shared';
import {useState} from 'react';
import {toast} from 'sonner';

import {useTranslation} from '../../lib/i18n';
import {network} from '../../lib/network';

export type StepWithTemplate = WorkflowStep & {
  template?: {id: string; name: string} | null;
};

export interface EditStepDialogProps {
  step: StepWithTemplate;
  workflowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export interface UpdateStepInput {
  name: string;
  config: Record<string, unknown>;
  templateId?: string;
}

export function useStepUpdate(workflowId: string, stepId: string) {
  const {t} = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = async (input: UpdateStepInput): Promise<boolean> => {
    setIsSubmitting(true);
    try {
      await network.fetch<WorkflowStep, typeof WorkflowSchemas.updateStep>(
        'PATCH',
        `/workflows/${workflowId}/steps/${stepId}`,
        input as Parameters<typeof network.fetch>[2],
      );
      toast.success(t('workflowSteps.shared.stepUpdated'));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workflowSteps.shared.failedToUpdate'));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {update, isSubmitting};
}

export function getStepConfig(step: {config: unknown}): Record<string, unknown> {
  return step.config && typeof step.config === 'object' && !Array.isArray(step.config)
    ? (step.config as Record<string, unknown>)
    : {};
}

interface StepDialogShellProps {
  step: StepWithTemplate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
  children: React.ReactNode;
}

export function StepDialogShell({
  step,
  open,
  onOpenChange,
  name,
  onNameChange,
  onSubmit,
  isSubmitting,
  children,
}: StepDialogShellProps) {
  const {t} = useTranslation();
  const typeLabel = t(`workflowSteps.types.${step.type}.label`);
  const typeDescription = t(`workflowSteps.types.${step.type}.description`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workflowSteps.shared.editTitle', {type: typeLabel})}</DialogTitle>
          {typeDescription && <p className="text-sm text-neutral-500 mt-1">{typeDescription}</p>}
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <Label htmlFor="editStepName">{t('workflowSteps.shared.stepName')}</Label>
            <Input
              id="editStepName"
              type="text"
              value={name}
              onChange={e => onNameChange(e.target.value)}
              required
              placeholder={t('workflowSteps.shared.stepNamePlaceholder')}
              className="mt-1.5"
            />
          </div>

          {children}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.saving') : t('workflowSteps.shared.saveChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
