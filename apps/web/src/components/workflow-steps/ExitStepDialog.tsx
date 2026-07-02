import {Label, Select, SelectContent, SelectItemWithDescription, SelectTrigger, SelectValue} from '@plunk/ui';
import {useState} from 'react';

import {useTranslation} from '../../lib/i18n';

import {type EditStepDialogProps, getStepConfig, StepDialogShell, useStepUpdate} from './shared';

export function ExitStepDialog({step, workflowId, open, onOpenChange, onSuccess}: EditStepDialogProps) {
  const {t} = useTranslation();
  const config = getStepConfig(step);

  const [name, setName] = useState(step.name);
  const [exitReason, setExitReason] = useState(String(config.reason ?? 'completed'));

  const {update, isSubmitting} = useStepUpdate(workflowId, step.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const ok = await update({
      name,
      config: {reason: exitReason},
    });

    if (ok) {
      onOpenChange(false);
      onSuccess();
    }
  };

  return (
    <StepDialogShell
      step={step}
      open={open}
      onOpenChange={onOpenChange}
      name={name}
      onNameChange={setName}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    >
      <div>
        <Label htmlFor="editExitReason">{t('workflowSteps.exit.exitReason')}</Label>
        <Select value={exitReason} onValueChange={setExitReason}>
          <SelectTrigger id="editExitReason" className="mt-1.5">
            <SelectValue placeholder={t('workflowSteps.exit.selectReasonPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItemWithDescription value="completed" title={t('workflowSteps.exit.reasons.completedTitle')} description={t('workflowSteps.exit.reasons.completedDescription')} />
            <SelectItemWithDescription value="unsubscribed" title={t('workflowSteps.exit.reasons.unsubscribedTitle')} description={t('workflowSteps.exit.reasons.unsubscribedDescription')} />
            <SelectItemWithDescription value="not_eligible" title={t('workflowSteps.exit.reasons.notEligibleTitle')} description={t('workflowSteps.exit.reasons.notEligibleDescription')} />
            <SelectItemWithDescription value="opted_out" title={t('workflowSteps.exit.reasons.optedOutTitle')} description={t('workflowSteps.exit.reasons.optedOutDescription')} />
            <SelectItemWithDescription value="goal_achieved" title={t('workflowSteps.exit.reasons.goalAchievedTitle')} description={t('workflowSteps.exit.reasons.goalAchievedDescription')} />
            <SelectItemWithDescription value="duplicate" title={t('workflowSteps.exit.reasons.duplicateTitle')} description={t('workflowSteps.exit.reasons.duplicateDescription')} />
            <SelectItemWithDescription value="error" title={t('workflowSteps.exit.reasons.errorTitle')} description={t('workflowSteps.exit.reasons.errorDescription')} />
            <SelectItemWithDescription value="other" title={t('workflowSteps.exit.reasons.otherTitle')} description={t('workflowSteps.exit.reasons.otherDescription')} />
          </SelectContent>
        </Select>
      </div>
    </StepDialogShell>
  );
}
