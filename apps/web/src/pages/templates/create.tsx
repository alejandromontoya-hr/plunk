import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@plunk/ui';
import {NextSeo} from 'next-seo';
import {DashboardLayout} from '../../components/DashboardLayout';
import {EmailSettings} from '../../components/EmailSettings';
import {EmailEditor} from '../../components/EmailEditor';
import {network} from '../../lib/network';
import {useTranslation} from '../../lib/i18n';
import {EmailFormValidator} from '../../lib/validation';
import {ArrowLeft, TriangleAlert} from 'lucide-react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useState} from 'react';
import {toast} from 'sonner';
import {TemplateSchemas, detectUnsubscribeSignal} from '@plunk/shared';
import {useActiveProject} from '../../lib/contexts/ActiveProjectProvider';

export default function CreateTemplatePage() {
  const router = useRouter();
  const {t} = useTranslation();
  const {activeProject} = useActiveProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [from, setFrom] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [type, setType] = useState<'MARKETING' | 'TRANSACTIONAL' | 'HEADLESS'>('MARKETING');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = EmailFormValidator.validateTemplate({name, subject, body, from});
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);

    try {
      const template = await network.fetch<{id: string}, typeof TemplateSchemas.create>('POST', '/templates', {
        name,
        description: description || undefined,
        subject,
        body,
        from,
        fromName: fromName || null,
        replyTo: replyTo || null,
        type,
      });

      toast.success(t('templates.toast.created'));
      void router.push(`/templates/${template.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('templates.toast.createFailed'));
      setSaving(false);
    }
  };

  return (
    <>
      <NextSeo title={t('templates.create.seoTitle')} />
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3 sm:gap-4">
            <Button asChild variant="ghost" size="sm">
              <Link href="/templates"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('templates.create.title')}</h1>
              <p className="text-neutral-500 mt-1 text-sm sm:text-base">
                {t('templates.create.description')}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Row 1: Basic Info + Template Type */}
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>{t('templates.form.basicInfoTitle')}</CardTitle>
                  <CardDescription>{t('templates.form.basicInfoDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t('templates.form.nameLabel')} <span className="text-red-500">*</span></Label>
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                      placeholder={t('templates.form.namePlaceholder')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">{t('templates.form.descriptionLabel')}</Label>
                    <Input
                      id="description"
                      type="text"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder={t('templates.form.descriptionPlaceholder')}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('templates.form.typeTitle')}</CardTitle>
                  <CardDescription>{t('templates.form.typeDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-2">
                    {([
                      {value: 'MARKETING', label: t('templates.types.marketing'), description: t('templates.types.descriptions.marketing')},
                      {value: 'TRANSACTIONAL', label: t('templates.types.transactional'), description: t('templates.types.descriptions.transactional')},
                      {value: 'HEADLESS', label: t('templates.types.headless'), description: t('templates.types.descriptions.headless')},
                    ] as const).map(({value, label, description}) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setType(value)}
                        className={`flex items-center justify-between w-full min-h-[44px] px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                          type === value
                            ? 'border-neutral-900 bg-neutral-50'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <span className="font-medium text-sm text-neutral-900 shrink-0">{label}</span>
                        <span className="text-xs text-neutral-500 ml-4 text-right">{description}</span>
                      </button>
                    ))}
                  </div>
                  {type === 'HEADLESS' && !detectUnsubscribeSignal(body) && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
                      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100/60 px-3 py-2">
                        <TriangleAlert className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        <p className="text-xs font-semibold text-amber-900">{t('templates.unsubscribeWarning.title')}</p>
                      </div>
                      <div className="px-3 py-2.5 space-y-2">
                        <p className="text-xs text-amber-800 leading-relaxed">
                          {t('templates.unsubscribeWarning.body')}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <code className="inline-flex items-center rounded bg-amber-100 border border-amber-200 px-1.5 py-0.5 font-mono text-[11px] text-amber-900">
                            {'{{unsubscribeUrl}}'}
                          </code>
                          <code className="inline-flex items-center rounded bg-amber-100 border border-amber-200 px-1.5 py-0.5 font-mono text-[11px] text-amber-900">
                            {'{{manageUrl}}'}
                          </code>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Email Settings */}
            <Card>
              <CardHeader>
                <CardTitle>{t('templates.form.emailSettingsTitle')}</CardTitle>
                <CardDescription>{t('templates.form.emailSettingsDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="subject">{t('templates.form.subjectLabel')} <span className="text-red-500">*</span></Label>
                  <Input
                    id="subject"
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    required
                    placeholder={t('templates.form.subjectPlaceholder')}
                  />
                  <p className="text-xs text-neutral-500">{t('templates.form.variableHint', {variable: '{{variableName}}'})}</p>
                </div>

                <EmailSettings
                  from={from}
                  fromName={fromName}
                  replyTo={replyTo}
                  onFromChange={setFrom}
                  onFromNameChange={setFromName}
                  onReplyToChange={setReplyTo}
                  fromNamePlaceholder={activeProject?.name || t('templates.form.fromNamePlaceholder')}
                />
              </CardContent>
            </Card>

            {/* Email Body */}
            <Card className="overflow-visible">
              <CardHeader>
                <CardTitle>{t('templates.form.bodyTitle')}</CardTitle>
                <CardDescription>{t('templates.form.bodyDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <EmailEditor value={body} onChange={setBody} />
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <Button asChild variant="outline">
                <Link href="/templates">{t('common.cancel')}</Link>
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('templates.form.creatingButton') : t('templates.form.createButton')}
              </Button>
            </div>
          </form>
        </div>
      </DashboardLayout>
    </>
  );
}
