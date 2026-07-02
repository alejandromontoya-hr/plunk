import {Label, Select, SelectContent, SelectItemWithDescription, SelectTrigger, SelectValue, Input} from '@plunk/ui';
import {ExternalLink} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';

import {useTranslation} from '../../lib/i18n';
import {TemplateSearchPicker} from '../TemplateSearchPicker';

import {type EditStepDialogProps, getStepConfig, StepDialogShell, useStepUpdate} from './shared';

export function SendEmailStepDialog({step, workflowId, open, onOpenChange, onSuccess}: EditStepDialogProps) {
  const {t} = useTranslation();
  const config = getStepConfig(step);
  const recipient = config.recipient as {type?: string; customEmail?: string} | undefined;

  const [name, setName] = useState(step.name);
  const [templateId, setTemplateId] = useState(step.template?.id ?? '');
  const [recipientType, setRecipientType] = useState<'CONTACT' | 'CUSTOM'>(
    recipient?.type === 'CUSTOM' ? 'CUSTOM' : 'CONTACT',
  );
  const [customEmail, setCustomEmail] = useState(recipient?.customEmail ?? '');

  const {update, isSubmitting} = useStepUpdate(workflowId, step.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!templateId) {
      toast.error(t('workflowSteps.sendEmail.selectTemplateError'));
      return;
    }

    if (recipientType === 'CUSTOM') {
      if (!customEmail.trim()) {
        toast.error(t('workflowSteps.sendEmail.enterCustomEmailError'));
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customEmail)) {
        toast.error(t('workflowSteps.sendEmail.invalidEmailError'));
        return;
      }
    }

    const ok = await update({
      name,
      templateId,
      config: {
        templateId,
        recipient: {
          type: recipientType,
          ...(recipientType === 'CUSTOM' && {customEmail: customEmail.trim()}),
        },
      },
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
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="editTemplate">{t('workflowSteps.sendEmail.emailTemplate')}</Label>
            {templateId && (
              <a
                href={`/templates/${templateId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-blue-600 transition-colors"
              >
                {t('workflowSteps.sendEmail.editTemplate')}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <TemplateSearchPicker value={templateId} initialName={step.template?.name} onChange={setTemplateId} />
        </div>

        <div>
          <Label htmlFor="editRecipientType">{t('workflowSteps.sendEmail.sendTo')}</Label>
          <Select value={recipientType} onValueChange={value => setRecipientType(value as 'CONTACT' | 'CUSTOM')}>
            <SelectTrigger id="editRecipientType" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItemWithDescription
                value="CONTACT"
                title={t('workflowSteps.sendEmail.recipientContactTitle')}
                description={t('workflowSteps.sendEmail.recipientContactDescription')}
              />
              <SelectItemWithDescription
                value="CUSTOM"
                title={t('workflowSteps.sendEmail.recipientCustomTitle')}
                description={t('workflowSteps.sendEmail.recipientCustomDescription')}
              />
            </SelectContent>
          </Select>
        </div>

        {recipientType === 'CUSTOM' && (
          <div>
            <Label htmlFor="editCustomEmail">{t('workflowSteps.sendEmail.emailAddress')}</Label>
            <Input
              id="editCustomEmail"
              type="email"
              value={customEmail}
              onChange={e => setCustomEmail(e.target.value)}
              required
              placeholder={t('workflowSteps.sendEmail.emailAddressPlaceholder')}
              className="mt-1.5"
            />
          </div>
        )}
      </div>
    </StepDialogShell>
  );
}
