/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IconSpinner,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItemWithDescription,
  SelectTrigger,
  SelectValue,
} from '@plunk/ui';
import type {Segment, Template} from '@plunk/db';
import {CampaignAudienceType, TemplateType} from '@plunk/db';
import {NextSeo} from 'next-seo';
import {DashboardLayout} from '../../components/DashboardLayout';
import {EmailSettings} from '../../components/EmailSettings';
import {EmailEditor} from '../../components/EmailEditor';
import {network} from '../../lib/network';
import {EmailFormValidator} from '../../lib/validation';
import {ArrowLeft, TriangleAlert} from 'lucide-react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import {detectUnsubscribeSignal} from '@plunk/shared';
import {useActiveProject} from '../../lib/contexts/ActiveProjectProvider';
import {useTranslation} from '../../lib/i18n';

export default function CreateCampaignPage() {
  const {t} = useTranslation();
  const router = useRouter();
  const {activeProject} = useActiveProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [from, setFrom] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [campaignType, setCampaignType] = useState<TemplateType>(TemplateType.MARKETING);
  const [audienceType, setAudienceType] = useState<CampaignAudienceType>(CampaignAudienceType.ALL);
  const [segmentId, setSegmentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const {data: segments} = useSWR<Segment[]>('/segments', {revalidateOnFocus: false});

  useEffect(() => {
    const loadData = async () => {
      const {
        templateId,
        campaignId,
        name: queryName,
        subject: querySubject,
        from: queryFrom,
        fromName: queryFromName,
        replyTo: queryReplyTo,
        audienceType: queryAudienceType,
        segmentId: querySegmentId,
      } = router.query;

      if (templateId && typeof templateId === 'string') {
        setLoadingTemplate(true);
        try {
          const template = await network.fetch<Template>('GET', `/templates/${templateId}`);
          if (queryName && typeof queryName === 'string') setName(queryName);
          if (querySubject && typeof querySubject === 'string') setSubject(querySubject);
          if (queryFrom && typeof queryFrom === 'string') setFrom(queryFrom);
          if (queryFromName && typeof queryFromName === 'string') setFromName(queryFromName);
          if (queryReplyTo && typeof queryReplyTo === 'string') setReplyTo(queryReplyTo);
          setBody(template.body);
          toast.success(t('campaigns.toast.templateLoaded'));
        } catch {
          toast.error(t('campaigns.toast.templateLoadFailed'));
        } finally {
          setLoadingTemplate(false);
        }
      } else if (campaignId && typeof campaignId === 'string') {
        setLoadingTemplate(true);
        try {
          const campaign = await network.fetch<{data: {body: string}}>('GET', `/campaigns/${campaignId}`);
          if (queryName && typeof queryName === 'string') setName(queryName);
          if (querySubject && typeof querySubject === 'string') setSubject(querySubject);
          if (queryFrom && typeof queryFrom === 'string') setFrom(queryFrom);
          if (queryFromName && typeof queryFromName === 'string') setFromName(queryFromName);
          if (queryReplyTo && typeof queryReplyTo === 'string') setReplyTo(queryReplyTo);
          if (queryAudienceType && typeof queryAudienceType === 'string') {
            setAudienceType(queryAudienceType as CampaignAudienceType);
          }
          if (querySegmentId && typeof querySegmentId === 'string') setSegmentId(querySegmentId);
          setBody(campaign.data.body);
          toast.success(t('campaigns.toast.campaignLoaded'));
        } catch {
          toast.error(t('campaigns.toast.campaignLoadFailed'));
        } finally {
          setLoadingTemplate(false);
        }
      } else {
        if (queryName && typeof queryName === 'string') setName(queryName);
        if (querySubject && typeof querySubject === 'string') setSubject(querySubject);
        if (queryFrom && typeof queryFrom === 'string') setFrom(queryFrom);
        if (queryFromName && typeof queryFromName === 'string') setFromName(queryFromName);
        if (queryReplyTo && typeof queryReplyTo === 'string') setReplyTo(queryReplyTo);
        if (queryAudienceType && typeof queryAudienceType === 'string') {
          setAudienceType(queryAudienceType as CampaignAudienceType);
        }
        if (querySegmentId && typeof querySegmentId === 'string') setSegmentId(querySegmentId);
      }
    };

    if (router.isReady) {
      void loadData();
    }
  }, [router.isReady, router.query]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = EmailFormValidator.validateCampaign({name, subject, body, from, segmentId}, audienceType);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);

    try {
      const response = await network.fetch<{data: {id: string}}>('POST', '/campaigns', {
        name,
        description: description || undefined,
        subject,
        body,
        from,
        fromName: fromName || null,
        replyTo: replyTo || null,
        type: campaignType,
        audienceType,
        segmentId: audienceType === CampaignAudienceType.SEGMENT ? segmentId : undefined,
        audienceFilter: audienceType === CampaignAudienceType.FILTERED ? [] : undefined,
      } as any);

      toast.success(t('campaigns.toast.created'));
      void router.push(`/campaigns/${response.data.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('campaigns.toast.createFailed'));
      setSaving(false);
    }
  };

  const getEstimatedRecipients = () => {
    if (audienceType === CampaignAudienceType.SEGMENT && segmentId && segments) {
      const segment = segments.find(s => s.id === segmentId);
      return segment?.memberCount || 0;
    }
    return 0;
  };

  const estimatedRecipients = getEstimatedRecipients();

  return (
    <>
      <NextSeo title={t('campaigns.create.seoTitle')} />
      <DashboardLayout>
        {loadingTemplate && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
            <div className="bg-white rounded-lg p-5 flex items-center gap-3">
              <IconSpinner />
              <p className="text-sm text-neutral-700">{t('campaigns.create.loadingTemplate')}</p>
            </div>
          </div>
        )}
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3 sm:gap-4">
            <Button asChild variant="ghost" size="sm">
              <Link href="/campaigns"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('campaigns.create.heading')}</h1>
              <p className="text-neutral-500 mt-1 text-sm sm:text-base">
                {t('campaigns.create.subtitle')}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="space-y-6">
              {/* Row 1: Basic Info + Campaign Type */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Basic Information */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('campaigns.basicInfo.title')}</CardTitle>
                    <CardDescription>{t('campaigns.basicInfo.description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">
                        {t('campaigns.basicInfo.nameLabel')} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="name"
                        placeholder={t('campaigns.basicInfo.namePlaceholder')}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">{t('campaigns.basicInfo.descriptionLabel')}</Label>
                      <Input
                        id="description"
                        placeholder={t('campaigns.basicInfo.descriptionPlaceholder')}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Campaign Type */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('campaigns.campaignType.title')}</CardTitle>
                    <CardDescription>{t('campaigns.campaignType.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-2">
                      {([
                        {value: TemplateType.MARKETING, label: t('campaigns.campaignType.marketing'), description: t('campaigns.campaignType.marketingDescription')},
                        {value: TemplateType.TRANSACTIONAL, label: t('campaigns.campaignType.transactional'), description: t('campaigns.campaignType.transactionalDescription')},
                        {value: TemplateType.HEADLESS, label: t('campaigns.campaignType.headless'), description: t('campaigns.campaignType.headlessDescription')},
                      ] as const).map(({value, label, description}) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setCampaignType(value)}
                          className={`flex items-center justify-between w-full min-h-[44px] px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                            campaignType === value
                              ? 'border-neutral-900 bg-neutral-50'
                              : 'border-neutral-200 hover:border-neutral-300'
                          }`}
                        >
                          <span className="font-medium text-sm text-neutral-900 shrink-0">{label}</span>
                          <span className="text-xs text-neutral-500 ml-4 text-right">{description}</span>
                        </button>
                      ))}
                    </div>
                    {campaignType === TemplateType.HEADLESS && !detectUnsubscribeSignal(body) && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100/60 px-3 py-2">
                          <TriangleAlert className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <p className="text-xs font-semibold text-amber-900">{t('campaigns.campaignType.noUnsubscribeTitle')}</p>
                        </div>
                        <div className="px-3 py-2.5 space-y-2">
                          <p className="text-xs text-amber-800 leading-relaxed">
                            {t('campaigns.campaignType.noUnsubscribeBody')}
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
                  <CardTitle>{t('campaigns.emailSettings.title')}</CardTitle>
                  <CardDescription>{t('campaigns.emailSettings.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <EmailSettings
                    from={from}
                    fromName={fromName}
                    replyTo={replyTo}
                    onFromChange={setFrom}
                    onFromNameChange={setFromName}
                    onReplyToChange={setReplyTo}
                    fromNamePlaceholder={activeProject?.name || 'Your Company'}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="subject">
                      {t('campaigns.emailSettings.subjectLabel')} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="subject"
                      placeholder={t('campaigns.emailSettings.subjectPlaceholder')}
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      required
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Email Content */}
              <Card className="overflow-visible">
                <CardHeader>
                  <CardTitle>{t('campaigns.emailContent.title')}</CardTitle>
                  <CardDescription>{t('campaigns.emailContent.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <EmailEditor value={body} onChange={setBody} />
                </CardContent>
              </Card>

              {/* Audience */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('campaigns.audience.title')}</CardTitle>
                  <CardDescription>{t('campaigns.audience.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="audienceType">
                      {t('campaigns.audience.typeLabel')} <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={audienceType}
                      onValueChange={value => setAudienceType(value as CampaignAudienceType)}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('campaigns.audience.typePlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItemWithDescription
                          value={CampaignAudienceType.ALL}
                          title={campaignType === TemplateType.TRANSACTIONAL ? t('campaigns.audience.allContacts') : t('campaigns.audience.allSubscribedContacts')}
                          description={campaignType === TemplateType.TRANSACTIONAL ? t('campaigns.audience.allContactsDescription') : t('campaigns.audience.allSubscribedDescription')}
                        />
                        <SelectItemWithDescription
                          value={CampaignAudienceType.SEGMENT}
                          title={t('campaigns.audience.specificSegment')}
                          description={t('campaigns.audience.specificSegmentDescription')}
                        />
                      </SelectContent>
                    </Select>
                  </div>

                  {audienceType === CampaignAudienceType.SEGMENT && (
                    <div className="space-y-2">
                      <Label htmlFor="segment">
                        {t('campaigns.audience.selectSegmentLabel')} <span className="text-red-500">*</span>
                      </Label>
                      <Select value={segmentId} onValueChange={setSegmentId} required>
                        <SelectTrigger>
                          <SelectValue placeholder={t('campaigns.audience.selectSegmentPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {segments?.map(segment => (
                            <SelectItemWithDescription
                              key={segment.id}
                              value={segment.id}
                              title={segment.name}
                              description={t('campaigns.audience.segmentContacts', {count: segment.memberCount.toLocaleString()})}
                            />
                          ))}
                        </SelectContent>
                      </Select>
                      {segments?.length === 0 && (
                        <p className="text-sm text-neutral-500">
                          {t('campaigns.audience.noSegmentsFound')}{' '}
                          <Link href="/segments/new" className="underline">
                            {t('campaigns.audience.createOneFirst')}
                          </Link>
                        </p>
                      )}
                      {estimatedRecipients > 0 && (
                        <p className="text-sm text-neutral-500">
                          <span className="font-medium text-neutral-900">{t('campaigns.audience.recipientsInSegment', {count: estimatedRecipients.toLocaleString()})}</span> {t('campaigns.audience.inThisSegment')}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <Button asChild variant="outline">
                  <Link href="/campaigns">{t('common.cancel')}</Link>
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? t('campaigns.create.creating') : t('campaigns.create.submit')}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DashboardLayout>
    </>
  );
}
