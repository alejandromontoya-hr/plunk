/* eslint-disable @typescript-eslint/no-explicit-any */
import {
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectItemWithDescription,
  SelectTrigger,
  SelectValue,
  IconSpinner,
  StickySaveBar,
} from '@plunk/ui';
import type {Campaign, Segment} from '@plunk/db';
import {CampaignAudienceType, CampaignStatus, TemplateType} from '@plunk/db';
import {CampaignSchemas, detectUnsubscribeSignal} from '@plunk/shared';
import {DashboardLayout} from '../../components/DashboardLayout';
import {EmailSettings} from '../../components/EmailSettings';
import {EmailEditor} from '../../components/EmailEditor';
import {network} from '../../lib/network';
import {formatFullDateTime, formatUTCDateTime, getUserTimezone, schedulePresets} from '../../lib/dateUtils';
import {useChangeTracking} from '../../lib/hooks/useChangeTracking';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  Info,
  Mail,
  MousePointer,
  Save,
  Send,
  TestTube,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import {NextSeo} from 'next-seo';
import {useActiveProject} from '../../lib/contexts/ActiveProjectProvider';
import {useTranslation} from '../../lib/i18n';

interface CampaignStats {
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  deliveryRate: number;
}

export default function CampaignDetailsPage() {
  const {t} = useTranslation();
  const router = useRouter();
  const {id} = router.query;
  const {activeProject} = useActiveProject();

  const {
    data: campaign,
    mutate,
    isLoading,
  } = useSWR<{data: Campaign}>(id ? `/campaigns/${id}` : null, {revalidateOnFocus: false});

  const {data: stats} = useSWR<{data: CampaignStats}>(
    id && campaign?.data.status !== CampaignStatus.DRAFT ? `/campaigns/${id}/stats` : null,
    {
      revalidateOnFocus: false,
      refreshInterval: campaign?.data.status === CampaignStatus.SENDING ? 15000 : 0, // Refresh every 15s while sending
    },
  );

  // Fetch segments for audience selection
  const {data: segments} = useSWR<Segment[]>('/segments', {
    revalidateOnFocus: false,
  });

  // Fetch project members for test email
  const {data: projectMembers} = useSWR<{data: Array<{userId: string; email: string; role: string}>}>(
    id && campaign?.data.projectId ? `/projects/${campaign.data.projectId}/members` : null,
    {revalidateOnFocus: false},
  );

  const [editedCampaign, setEditedCampaign] = useState<Partial<Campaign>>({});
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [testEmailAddress, setTestEmailAddress] = useState('');

  type CampaignDialog =
    | {type: 'none'}
    | {type: 'schedule'}
    | {type: 'testEmail'; sending: boolean}
    | {type: 'send'}
    | {type: 'cancel'}
    | {type: 'delete'};

  const [dialog, setDialog] = useState<CampaignDialog>({type: 'none'});
  const [intentHandled, setIntentHandled] = useState(false);

  // Arriving from the segment results view with "Programar envío" opens the
  // schedule dialog straight away (audience is already preset to the selection).
  useEffect(() => {
    if (intentHandled || !router.isReady) return;
    if (router.query.intent === 'schedule' && campaign?.data.status === CampaignStatus.DRAFT) {
      setDialog({type: 'schedule'});
      setIntentHandled(true);
    }
  }, [router.isReady, router.query.intent, campaign?.data.status, intentHandled]);

  // Automatically initialize edit fields when campaign is loaded and is a draft
  const isEditMode = campaign?.data.status === CampaignStatus.DRAFT;

  const handleCancel = async () => {
    try {
      await network.fetch('POST', `/campaigns/${id}/cancel`);
      toast.success(t('campaigns.toast.cancelled'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('campaigns.toast.cancelFailed'));
    }
  };

  const handleDelete = async () => {
    try {
      await network.fetch('DELETE', `/campaigns/${id}`);
      toast.success(t('campaigns.toast.deleted'));
      void router.push('/campaigns');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('campaigns.toast.deleteFailed'));
    }
  };

  const handleSend = async () => {
    try {
      await network.fetch<void>('POST', `/campaigns/${id}/send`);
      toast.success(t('campaigns.toast.sending'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('campaigns.toast.sendFailed'));
    }
  };

  const handleSchedule = async () => {
    if (!scheduledDateTime) {
      toast.error(t('campaigns.toast.selectDateTime'));
      return;
    }

    // Parse the datetime-local value as local time, then convert to UTC
    const scheduledDate = new Date(scheduledDateTime);
    const now = new Date();

    if (scheduledDate.getTime() <= now.getTime()) {
      toast.error(t('campaigns.toast.futureTime'));
      return;
    }

    try {
      // Send as ISO string (UTC)
      await network.fetch<void, typeof CampaignSchemas.schedule>('POST', `/campaigns/${id}/send`, {
        scheduledFor: scheduledDate.toISOString(),
      });

      // Show confirmation with user's local time
      const localTimeString = formatFullDateTime(scheduledDate);
      toast.success(t('campaigns.toast.scheduled', {time: localTimeString}));
      setDialog({type: 'none'});
      setScheduledDateTime('');
      setSelectedPreset(null);
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('campaigns.toast.scheduleFailed'));
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddress) {
      toast.error(t('campaigns.toast.selectMember'));
      return;
    }

    setDialog({type: 'testEmail', sending: true});

    try {
      await network.fetch<{success: boolean; message: string}>('POST', `/campaigns/${id}/test`, {
        email: testEmailAddress,
      } as any);

      toast.success(t('campaigns.toast.testSent', {email: testEmailAddress}));
      setDialog({type: 'none'});
      setTestEmailAddress('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('campaigns.toast.testFailed'));
    } finally {
      setDialog(d => (d.type === 'testEmail' ? {type: 'testEmail', sending: false} : d));
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);

    try {
      await network.fetch<Campaign, typeof CampaignSchemas.update>('PUT', `/campaigns/${id}`, {
        name: editedCampaign.name,
        description: editedCampaign.description || undefined,
        subject: editedCampaign.subject,
        body: editedCampaign.body,
        from: editedCampaign.from,
        fromName: editedCampaign.fromName || null,
        replyTo: editedCampaign.replyTo || null,
        type: editedCampaign.type,
        audienceType: editedCampaign.audienceType,
        segmentId: editedCampaign.segmentId || undefined,
      });
      // Silent save - no toast notification
      setHasChanges(false);
      // Refetch and re-sync the edited campaign with fresh data
      const updated = await mutate();
      if (updated?.data) {
        setEditedCampaign({
          name: updated.data.name,
          description: updated.data.description || '',
          subject: updated.data.subject,
          body: updated.data.body,
          from: updated.data.from,
          fromName: updated.data.fromName || '',
          replyTo: updated.data.replyTo || '',
          type: updated.data.type,
          audienceType: updated.data.audienceType,
          segmentId: updated.data.segmentId || undefined,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('campaigns.toast.updateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Initialize edit fields when campaign loads and is a draft
  useEffect(() => {
    if (campaign?.data && isEditMode && Object.keys(editedCampaign).length === 0) {
      setEditedCampaign({
        name: campaign.data.name,
        description: campaign.data.description || '',
        subject: campaign.data.subject,
        body: campaign.data.body,
        from: campaign.data.from,
        fromName: campaign.data.fromName || '',
        replyTo: campaign.data.replyTo || '',
        type: campaign.data.type,
        audienceType: campaign.data.audienceType,
        segmentId: campaign.data.segmentId || undefined,
      });
      // Reset hasChanges when loading fresh data
      setHasChanges(false);
    }
  }, [campaign, isEditMode, editedCampaign]);

  // Track changes
  useEffect(() => {
    if (!campaign?.data || Object.keys(editedCampaign).length === 0) return;

    const changed =
      editedCampaign.name !== campaign.data.name ||
      (editedCampaign.description || '') !== (campaign.data.description || '') ||
      editedCampaign.subject !== campaign.data.subject ||
      editedCampaign.body !== campaign.data.body ||
      editedCampaign.from !== campaign.data.from ||
      (editedCampaign.fromName || '') !== (campaign.data.fromName || '') ||
      (editedCampaign.replyTo || '') !== (campaign.data.replyTo || '') ||
      editedCampaign.type !== campaign.data.type ||
      editedCampaign.audienceType !== campaign.data.audienceType ||
      (editedCampaign.segmentId || null) !== (campaign.data.segmentId || null);

    setHasChanges(changed);
  }, [editedCampaign, campaign]);

  // Warn before leaving page with unsaved changes (only in edit mode)
  useChangeTracking(hasChanges, isEditMode);

  const getStatusBadge = (status: CampaignStatus) => {
    const variants: Record<
      CampaignStatus,
      {variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string}
    > = {
      DRAFT: {variant: 'secondary', label: t('campaigns.status.DRAFT')},
      SCHEDULED: {variant: 'default', label: t('campaigns.status.SCHEDULED')},
      SENDING: {variant: 'default', label: t('campaigns.status.SENDING')},
      SENT: {variant: 'default', label: t('campaigns.status.SENT')},
      CANCELLED: {variant: 'destructive', label: t('campaigns.status.CANCELLED')},
    };

    const config = variants[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <IconSpinner />
        </div>
      </DashboardLayout>
    );
  }

  if (!campaign) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-neutral-500">{t('campaigns.detail.notFound')}</p>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const c = campaign.data;
  const s = stats?.data;

  // Get recipient count for draft campaigns from the campaign's totalRecipients field
  // The backend calculates this for all audience types when the campaign is created/updated
  const draftRecipientCount = isEditMode && campaign?.data ? campaign.data.totalRecipients : 0;

  // Render edit form for drafts
  if (isEditMode) {
    return (
      <DashboardLayout>
        <NextSeo title={campaign.data.name} />
        <form onSubmit={handleSave} className={`space-y-6 ${hasChanges ? 'pb-32' : ''}`}>
          {/* Header */}
          <div className="space-y-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Button asChild variant="ghost" size="sm">
                <Link href="/campaigns"><ArrowLeft className="h-4 w-4" /></Link>
              </Button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 sm:gap-3">
                  <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 truncate">{c.name}</h1>
                  <Badge variant="secondary">{t('campaigns.status.DRAFT')}</Badge>
                </div>
                <p className="text-neutral-500 mt-1 text-sm sm:text-base">
                  {t('campaigns.detail.editSubtitle')}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                {!hasChanges && !isSubmitting && (
                  <span className="text-xs sm:text-sm text-neutral-500">{t('campaigns.detail.allChangesSaved')}</span>
                )}
                {hasChanges && !isSubmitting && (
                  <span className="text-xs sm:text-sm text-amber-600">{t('campaigns.detail.unsavedChanges')}</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setDialog({type: 'delete'})}
                  className="flex-1 sm:flex-none"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('campaigns.detail.delete')}</span>
                </Button>
                <Button
                  type="submit"
                  disabled={!hasChanges || isSubmitting}
                  variant="outline"
                  className="flex-1 sm:flex-none"
                >
                  <Save className="h-4 w-4" />
                  <span className="hidden sm:inline">{isSubmitting ? t('campaigns.detail.saving') : t('campaigns.detail.save')}</span>
                  <span className="sm:hidden">{t('campaigns.detail.save')}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" className="flex-1 sm:flex-none">
                      <Send className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('campaigns.detail.send')}</span>
                      <ChevronDown className="h-4 w-4 sm:ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuItem onClick={() => setDialog({type: 'testEmail', sending: false})} className="py-3 cursor-pointer">
                      <div className="flex items-start gap-3">
                        <TestTube className="h-4 w-4 mt-0.5 text-neutral-700" />
                        <div className="flex flex-col gap-0.5 flex-1">
                          <span className="font-medium text-sm">{t('campaigns.detail.sendTestEmail')}</span>
                          <span className="text-xs text-neutral-500 leading-snug">
                            {t('campaigns.detail.sendTestEmailDescription')}
                          </span>
                        </div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDialog({type: 'send'})} className="py-3 cursor-pointer">
                      <div className="flex items-start gap-3">
                        <Send className="h-4 w-4 mt-0.5 text-neutral-700" />
                        <div className="flex flex-col gap-0.5 flex-1">
                          <span className="font-medium text-sm">{t('campaigns.detail.sendNow')}</span>
                          <span className="text-xs text-neutral-500 leading-snug">
                            {t('campaigns.detail.sendNowDescription')}
                          </span>
                        </div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDialog({type: 'schedule'})} className="py-3 cursor-pointer">
                      <div className="flex items-start gap-3">
                        <Calendar className="h-4 w-4 mt-0.5 text-neutral-700" />
                        <div className="flex flex-col gap-0.5 flex-1">
                          <span className="font-medium text-sm">{t('campaigns.detail.scheduleForLater')}</span>
                          <span className="text-xs text-neutral-500 leading-snug">{t('campaigns.detail.scheduleForLaterDescription')}</span>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Audience — surfaced first because Send lives in the header.
              Users need to see who/how many before pressing Send. */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{t('campaigns.audience.title')}</CardTitle>
                <CardDescription>{t('campaigns.audience.descriptionEdit')}</CardDescription>
              </div>
              {draftRecipientCount > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 shrink-0">
                  <Users className="h-4 w-4 text-neutral-500" />
                  <span className="text-sm font-semibold text-neutral-900 tabular-nums">
                    {draftRecipientCount.toLocaleString()} {draftRecipientCount === 1 ? t('campaigns.audience.recipient') : t('campaigns.audience.recipients')}
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="audienceType">
                    {t('campaigns.audience.typeLabel')} <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={editedCampaign.audienceType ?? c.audienceType}
                    onValueChange={(value: CampaignAudienceType) => {
                      setEditedCampaign({
                        ...editedCampaign,
                        audienceType: value,
                        segmentId: value === CampaignAudienceType.SEGMENT ? editedCampaign.segmentId : undefined,
                      });
                    }}
                  >
                    <SelectTrigger id="audienceType">
                      <SelectValue placeholder={t('campaigns.audience.typePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItemWithDescription
                        value={CampaignAudienceType.ALL}
                        title={(editedCampaign.type ?? c.type) === TemplateType.TRANSACTIONAL ? t('campaigns.audience.allContacts') : t('campaigns.audience.allSubscribedContacts')}
                        description={(editedCampaign.type ?? c.type) === TemplateType.TRANSACTIONAL ? t('campaigns.audience.allContactsDescription') : t('campaigns.audience.allSubscribedDescription')}
                      />
                      <SelectItemWithDescription
                        value={CampaignAudienceType.SEGMENT}
                        title={t('campaigns.audience.specificSegment')}
                        description={t('campaigns.audience.specificSegmentDescription')}
                      />
                    </SelectContent>
                  </Select>
                </div>

                {(editedCampaign.audienceType ?? c.audienceType) === CampaignAudienceType.SEGMENT && (
                  <div className="space-y-2">
                    <Label htmlFor="segment">
                      {t('campaigns.audience.selectSegmentLabel')} <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={editedCampaign.segmentId ?? c.segmentId ?? undefined}
                      onValueChange={(value: string) => {
                        setEditedCampaign({
                          ...editedCampaign,
                          segmentId: value,
                        });
                      }}
                      disabled={!segments || segments.length === 0}
                    >
                      <SelectTrigger id="segment">
                        <SelectValue
                          placeholder={segments && segments.length > 0 ? t('campaigns.audience.selectSegmentPlaceholder') : t('campaigns.audience.noSegmentsPlaceholder')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {segments &&
                          segments.length > 0 &&
                          segments.map(segment => (
                            <SelectItemWithDescription
                              key={segment.id}
                              value={segment.id}
                              title={segment.name}
                              description={t('campaigns.audience.segmentContacts', {count: segment.memberCount.toLocaleString()})}
                            />
                          ))}
                      </SelectContent>
                    </Select>
                    {segments && segments.length === 0 && (
                      <p className="text-sm text-neutral-500">
                        {t('campaigns.audience.noSegmentsFound')}{' '}
                        <Link href="/segments/new" className="underline">
                          {t('campaigns.audience.createOneFirst')}
                        </Link>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {editedCampaign.audienceType === CampaignAudienceType.FILTERED && (
                <p className="text-sm text-neutral-500">
                  {t('campaigns.audience.filteredDescription')}
                </p>
              )}

              {draftRecipientCount > 0 && (
                <p className="text-xs text-neutral-500">
                  {(editedCampaign.type ?? c.type) === TemplateType.TRANSACTIONAL
                    ? t('campaigns.audience.recalcTransactional')
                    : t('campaigns.audience.recalcMarketing')
                  }
                </p>
              )}
            </CardContent>
          </Card>

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
                    value={editedCampaign.name || ''}
                    onChange={e => setEditedCampaign({...editedCampaign, name: e.target.value})}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">{t('campaigns.basicInfo.descriptionLabel')}</Label>
                  <Input
                    id="description"
                    placeholder={t('campaigns.basicInfo.descriptionPlaceholder')}
                    value={editedCampaign.description || ''}
                    onChange={e => setEditedCampaign({...editedCampaign, description: e.target.value})}
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
                      onClick={() => setEditedCampaign({...editedCampaign, type: value})}
                      className={`flex items-center justify-between w-full min-h-[44px] px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                        (editedCampaign.type ?? c.type) === value
                          ? 'border-neutral-900 bg-neutral-50'
                          : 'border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <span className="font-medium text-sm text-neutral-900 shrink-0">{label}</span>
                      <span className="text-xs text-neutral-500 ml-4 text-right">{description}</span>
                    </button>
                  ))}
                </div>
                {(editedCampaign.type ?? c.type) === TemplateType.HEADLESS &&
                  !detectUnsubscribeSignal(editedCampaign.body ?? c.body) && (
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
                from={editedCampaign.from || ''}
                fromName={editedCampaign.fromName || ''}
                replyTo={editedCampaign.replyTo || ''}
                onFromChange={value => setEditedCampaign({...editedCampaign, from: value})}
                onFromNameChange={value => setEditedCampaign({...editedCampaign, fromName: value})}
                onReplyToChange={value => setEditedCampaign({...editedCampaign, replyTo: value})}
                fromNamePlaceholder={activeProject?.name || 'Your Company'}
              />

              <div className="space-y-2">
                <Label htmlFor="subject">
                  {t('campaigns.emailSettings.subjectLabel')} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="subject"
                  placeholder={t('campaigns.emailSettings.subjectPlaceholder')}
                  value={editedCampaign.subject || ''}
                  onChange={e => setEditedCampaign({...editedCampaign, subject: e.target.value})}
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
              <EmailEditor
                value={editedCampaign.body || ''}
                onChange={body => {
                  setEditedCampaign({...editedCampaign, body});
                  setHasChanges(true);
                }}
              />
            </CardContent>
          </Card>

          {/* Test Email Dialog */}
          <Dialog open={dialog.type === 'testEmail'} onOpenChange={open => !open && setDialog({type: 'none'})}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('campaigns.testDialog.title')}</DialogTitle>
                <DialogDescription>
                  {t('campaigns.testDialog.description')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="testEmail">{t('campaigns.testDialog.sendToLabel')}</Label>
                <Select value={testEmailAddress} onValueChange={setTestEmailAddress}>
                  <SelectTrigger id="testEmail">
                    <SelectValue placeholder={t('campaigns.testDialog.sendToPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {projectMembers?.data.map(member => (
                      <SelectItem key={member.userId} value={member.email}>
                        {member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Preview of how the email will arrive */}
              <div className="space-y-2">
                <Label className="text-neutral-500">{t('campaigns.testDialog.willArriveLabel')}</Label>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 divide-y divide-neutral-200 text-sm">
                  <div className="grid grid-cols-[64px_1fr] gap-3 px-3 py-2.5">
                    <span className="text-neutral-500">{t('campaigns.testDialog.from')}</span>
                    <span className="text-neutral-900 truncate">{editedCampaign.from || c.from}</span>
                  </div>
                  <div className="grid grid-cols-[64px_1fr] gap-3 px-3 py-2.5">
                    <span className="text-neutral-500">{t('campaigns.testDialog.subject')}</span>
                    <span className="text-neutral-900 truncate">
                      <span className="font-medium">[TEST]</span> {editedCampaign.subject || c.subject}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-neutral-500 leading-relaxed">
                {t('campaigns.testDialog.variablesNote')}
              </p>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialog({type: 'none'});
                    setTestEmailAddress('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={handleSendTestEmail}
                  disabled={(dialog.type === 'testEmail' && dialog.sending) || !testEmailAddress}
                >
                  <TestTube className="h-4 w-4" />
                  {dialog.type === 'testEmail' && dialog.sending ? t('campaigns.testDialog.sending') : t('campaigns.testDialog.sendPreview')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Schedule Dialog */}
          <Dialog open={dialog.type === 'schedule'} onOpenChange={open => !open && setDialog({type: 'none'})}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('campaigns.scheduleDialog.title')}</DialogTitle>
                <DialogDescription>
                  {t('campaigns.scheduleDialog.description', {timezone: getUserTimezone()})}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 py-2">
                {/* Quick presets */}
                <div className="space-y-2">
                  <Label>{t('campaigns.scheduleDialog.quickOptions')}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      {key: 'in1h', label: t('campaigns.scheduleDialog.in1h'), getValue: schedulePresets.inOneHour},
                      {key: 'in3h', label: t('campaigns.scheduleDialog.in3h'), getValue: schedulePresets.inThreeHours},
                      {key: 'tom9', label: t('campaigns.scheduleDialog.tomorrow9'), getValue: schedulePresets.tomorrowAt9AM},
                      {key: 'tom2', label: t('campaigns.scheduleDialog.tomorrow2'), getValue: schedulePresets.tomorrowAt2PM},
                      {key: 'nextMon', label: t('campaigns.scheduleDialog.nextMonday'), getValue: schedulePresets.nextMonday},
                      {key: 'in1w', label: t('campaigns.scheduleDialog.in1w'), getValue: schedulePresets.inOneWeek},
                    ].map(({key, label, getValue}) => {
                      const isActive = selectedPreset === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setScheduledDateTime(getValue());
                            setSelectedPreset(key);
                          }}
                          className={`min-h-[40px] px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                            isActive
                              ? 'border-neutral-900 bg-neutral-50 text-neutral-900 font-medium'
                              : 'border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:text-neutral-900'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Date/Time */}
                <div className="space-y-2">
                  <Label htmlFor="scheduledDateTime">{t('campaigns.scheduleDialog.exactTimeLabel')}</Label>
                  <Input
                    id="scheduledDateTime"
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={e => {
                      setScheduledDateTime(e.target.value);
                      setSelectedPreset(null);
                    }}
                    min={new Date().toISOString().slice(0, 16)}
                  />
                </div>

                {/* Confirmation preview — date + audience together */}
                {scheduledDateTime && (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 divide-y divide-neutral-200">
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-2 text-neutral-500">
                        <Calendar className="h-3.5 w-3.5" />
                        <span className="text-xs font-medium uppercase tracking-wide">{t('campaigns.scheduleDialog.sendingOn')}</span>
                      </div>
                      <p className="mt-1 text-base font-semibold text-neutral-900">
                        {formatFullDateTime(new Date(scheduledDateTime))}
                      </p>
                    </div>
                    {draftRecipientCount > 0 && (
                      <div className="px-4 py-3">
                        <div className="flex items-center gap-2 text-neutral-500">
                          <Users className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium uppercase tracking-wide">{t('campaigns.scheduleDialog.to')}</span>
                        </div>
                        <p className="mt-1 text-sm text-neutral-900">
                          <span className="font-semibold tabular-nums">{draftRecipientCount.toLocaleString()}</span>
                          <span className="text-neutral-600">
                            {draftRecipientCount === 1 ? ` ${t('campaigns.scheduleDialog.recipientIn')} ` : ` ${t('campaigns.scheduleDialog.recipientsIn')} `}
                          </span>
                          {(editedCampaign.audienceType ?? c.audienceType) === CampaignAudienceType.ALL &&
                            ((editedCampaign.type ?? c.type) === TemplateType.TRANSACTIONAL
                              ? t('campaigns.audience.allContactsLower')
                              : t('campaigns.audience.allSubscribedLower'))}
                          {(editedCampaign.audienceType ?? c.audienceType) === CampaignAudienceType.SEGMENT &&
                            (segments?.find(s => s.id === (editedCampaign.segmentId ?? c.segmentId))?.name ?? t('campaigns.audience.selectedSegment'))}
                          {(editedCampaign.audienceType ?? c.audienceType) === CampaignAudienceType.FILTERED && t('campaigns.audience.filteredContactsLower')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p className="text-xs text-neutral-500 leading-relaxed">
                {t('campaigns.scheduleDialog.editNote')}
              </p>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialog({type: 'none'});
                    setScheduledDateTime('');
                    setSelectedPreset(null);
                  }}
                >
                  {t('campaigns.scheduleDialog.notYet')}
                </Button>
                <Button type="button" onClick={handleSchedule} disabled={!scheduledDateTime}>
                  <Calendar className="h-4 w-4" />
                  {t('campaigns.scheduleDialog.scheduleSend')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </form>

        {/* Sticky Save Bar */}
        <StickySaveBar status={isSubmitting ? 'saving' : hasChanges ? 'dirty' : 'idle'} onSave={handleSave} />

        <Dialog open={dialog.type === 'send'} onOpenChange={open => !open && setDialog({type: 'none'})}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('campaigns.sendDialog.title')}</DialogTitle>
              <DialogDescription>{t('campaigns.sendDialog.description')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Hero: recipient count */}
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-6 text-center">
                <div className="flex items-center justify-center gap-2 text-neutral-500">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">{t('campaigns.sendDialog.recipients')}</span>
                </div>
                <div className="mt-1.5 text-4xl font-bold text-neutral-900 tabular-nums">
                  {draftRecipientCount.toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {(editedCampaign.audienceType ?? c.audienceType) === CampaignAudienceType.ALL &&
                    ((editedCampaign.type ?? c.type) === TemplateType.TRANSACTIONAL
                      ? t('campaigns.audience.allContacts')
                      : t('campaigns.audience.allSubscribedContacts'))}
                  {(editedCampaign.audienceType ?? c.audienceType) === CampaignAudienceType.SEGMENT &&
                    (segments?.find(s => s.id === (editedCampaign.segmentId ?? c.segmentId))?.name ?? t('campaigns.audience.selectedSegmentTitle'))}
                  {(editedCampaign.audienceType ?? c.audienceType) === CampaignAudienceType.FILTERED && t('campaigns.audience.filteredContacts')}
                </div>
              </div>

              {/* Compact summary */}
              <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-200 text-sm">
                <div className="grid grid-cols-[80px_1fr] gap-3 px-3 py-2.5">
                  <span className="text-neutral-500">{t('campaigns.sendDialog.from')}</span>
                  <span className="text-neutral-900 truncate">{editedCampaign.from || c.from}</span>
                </div>
                <div className="grid grid-cols-[80px_1fr] gap-3 px-3 py-2.5">
                  <span className="text-neutral-500">{t('campaigns.sendDialog.subject')}</span>
                  <span className="text-neutral-900 truncate">{editedCampaign.subject || c.subject}</span>
                </div>
              </div>

              {/* Reassurance */}
              <div className="flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2.5">
                <Info className="h-4 w-4 text-neutral-500 mt-0.5 shrink-0" />
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {t('campaigns.sendDialog.reassurance')}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog({type: 'none'})}>
                {t('campaigns.sendDialog.notYet')}
              </Button>
              <Button onClick={async () => { await handleSend(); setDialog({type: 'none'}); }}>
                <Send className="h-4 w-4" />
                {draftRecipientCount === 1
                  ? t('campaigns.sendDialog.sendTo', {count: draftRecipientCount.toLocaleString()})
                  : t('campaigns.sendDialog.sendToPlural', {count: draftRecipientCount.toLocaleString()})}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={dialog.type === 'delete'}
          onOpenChange={open => !open && setDialog({type: 'none'})}
          onConfirm={handleDelete}
          title={t('campaigns.dialogs.deleteTitle')}
          description={t('campaigns.dialogs.deleteDescription')}
          confirmText={t('campaigns.dialogs.deleteConfirm')}
          variant="destructive"
        />
      </DashboardLayout>
    );
  }

  // Render stats view for sent/scheduled campaigns
  return (
    <DashboardLayout>
      <NextSeo title={campaign.data.name} />
      <div className="space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button asChild variant="ghost" size="sm">
              <Link href="/campaigns"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 mb-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 truncate">{c.name}</h1>
                {getStatusBadge(c.status)}
              </div>
              {c.description && <p className="text-neutral-500 text-sm sm:text-base">{c.description}</p>}
            </div>
          </div>

          {/* Actions */}
          {(c.status === CampaignStatus.SCHEDULED || c.status === CampaignStatus.SENDING) && (
            <div className="flex justify-end">
              <Button variant="destructive" onClick={() => setDialog({type: 'cancel'})} className="w-full sm:w-auto">
                <XCircle className="h-4 w-4" />
                <span className="hidden sm:inline">{t('campaigns.detail.cancelCampaign')}</span>
                <span className="sm:hidden">{t('campaigns.detail.cancelShort')}</span>
              </Button>
            </div>
          )}
        </div>

        {/* Sending Progress Banner */}
        {c.status === CampaignStatus.SENDING && s && (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-neutral-900 text-lg">{t('campaigns.stats.sendingInProgress')}</h3>
                    <p className="text-sm text-neutral-500 mt-1">
                      {t('campaigns.stats.emailsSent', {sent: s.sentCount.toLocaleString(), total: s.totalRecipients.toLocaleString()})}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-neutral-900">
                      {((s.sentCount / s.totalRecipients) * 100).toFixed(0)}%
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">{t('campaigns.stats.complete')}</p>
                  </div>
                </div>
                <div className="w-full bg-neutral-100 rounded-full h-2">
                  <div
                    className="bg-neutral-900 h-2 rounded-full transition-all duration-500"
                    style={{width: `${(s.sentCount / s.totalRecipients) * 100}%`}}
                  />
                </div>
                <p className="text-xs text-neutral-400">{t('campaigns.stats.autoUpdate')}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Cards */}
        {s && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-neutral-500">{t('campaigns.stats.totalRecipients')}</CardTitle>
                <Users className="h-4 w-4 text-neutral-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-neutral-900">{s.totalRecipients.toLocaleString()}</div>
                <p className="text-xs text-neutral-500 mt-2">
                  {t('campaigns.stats.sentPercent', {sent: s.sentCount.toLocaleString(), percent: ((s.sentCount / s.totalRecipients) * 100).toFixed(1)})}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-neutral-500">{t('campaigns.stats.deliveryRate')}</CardTitle>
                <Mail className="h-4 w-4 text-neutral-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-neutral-900">{s.deliveryRate.toFixed(1)}%</div>
                <p className="text-xs text-neutral-500 mt-2">
                  {t('campaigns.stats.delivered', {count: s.deliveredCount.toLocaleString()})}
                  {s.bouncedCount > 0 && t('campaigns.stats.bounced', {count: s.bouncedCount})}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-neutral-500">{t('campaigns.stats.openRate')}</CardTitle>
                <TrendingUp className="h-4 w-4 text-neutral-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-neutral-900">{s.openRate.toFixed(1)}%</div>
                <p className="text-xs text-neutral-500 mt-2">{t('campaigns.stats.opened', {count: s.openedCount.toLocaleString()})}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-neutral-500">{t('campaigns.stats.clickRate')}</CardTitle>
                <MousePointer className="h-4 w-4 text-neutral-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-neutral-900">{s.clickRate.toFixed(1)}%</div>
                <p className="text-xs text-neutral-500 mt-2">{t('campaigns.stats.clicked', {count: s.clickedCount.toLocaleString()})}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Campaign Details in Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Email Content - Takes 2 columns */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('campaigns.preview.title')}</CardTitle>
              <CardDescription>{t('campaigns.preview.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Email Header Info */}
              <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-xs text-neutral-500 uppercase tracking-wide font-medium">{t('campaigns.preview.subject')}</p>
                    <p className="text-base font-semibold text-neutral-900 mt-1">{c.subject}</p>
                  </div>
                </div>
                <div className="flex gap-6 pt-2 border-t border-neutral-200">
                  <div>
                    <p className="text-xs text-neutral-500">{t('campaigns.preview.from')}</p>
                    <p className="text-sm text-neutral-900 mt-0.5">{c.from}</p>
                  </div>
                  {c.replyTo && (
                    <div>
                      <p className="text-xs text-neutral-500">{t('campaigns.preview.replyTo')}</p>
                      <p className="text-sm text-neutral-900 mt-0.5">{c.replyTo}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Email Body Preview */}
              <div>
                <p className="text-sm font-medium text-neutral-700 mb-3">{t('campaigns.preview.messageContent')}</p>
                <div className="border-2 border-neutral-200 rounded-lg overflow-hidden bg-white">
                  <div className="p-6 max-h-96 overflow-y-auto">
                    <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(c.body)}} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Campaign Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t('campaigns.info.title')}</CardTitle>
              <CardDescription>{t('campaigns.info.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Audience */}
              <div className="pb-3 border-b border-neutral-100">
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">{t('campaigns.info.audience')}</p>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-neutral-900">
                      {c.audienceType === CampaignAudienceType.ALL && t('campaigns.audience.allSubscribedContacts')}
                      {c.audienceType === CampaignAudienceType.SEGMENT &&
                        (segments?.find(s => s.id === c.segmentId)?.name || t('campaigns.audience.selectedSegmentTitle'))}
                      {c.audienceType === CampaignAudienceType.FILTERED && t('campaigns.audience.filteredContacts')}
                    </p>
                    {c.audienceType === CampaignAudienceType.SEGMENT &&
                      segments?.find(s => s.id === c.segmentId)?.memberCount && (
                        <p className="text-xs text-neutral-500">
                          {t('campaigns.info.segmentContacts', {count: segments.find(s => s.id === c.segmentId)!.memberCount.toLocaleString()})}
                        </p>
                      )}
                  </div>
                </div>
              </div>

              {/* Scheduling Info */}
              {c.scheduledFor && (
                <div className="pb-3 border-b border-neutral-100">
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">{t('campaigns.info.scheduledFor')}</p>
                  <div className="flex items-start gap-2">
                    <Calendar className="h-4 w-4 text-neutral-400 mt-0.5" />
                    <div className="space-y-2">
                      <div>
                        <p className="text-sm font-medium text-neutral-900">
                          {formatFullDateTime(new Date(c.scheduledFor))}
                        </p>
                        <p className="text-xs text-neutral-500 mt-1">
                          {t('campaigns.info.utc', {time: formatUTCDateTime(new Date(c.scheduledFor))})}
                        </p>
                      </div>
                      {c.status === CampaignStatus.SCHEDULED && (
                        <p className="text-xs text-neutral-500">{t('campaigns.info.recalcNote')}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Sent At */}
              {c.sentAt && (
                <div className="pb-3 border-b border-neutral-100">
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">{t('campaigns.info.sentOn')}</p>
                  <div className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-neutral-400" />
                    <p className="text-sm font-medium text-neutral-900">{formatFullDateTime(new Date(c.sentAt))}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={dialog.type === 'cancel'}
        onOpenChange={open => !open && setDialog({type: 'none'})}
        onConfirm={handleCancel}
        title={t('campaigns.dialogs.cancelTitle')}
        description={t('campaigns.dialogs.cancelDescription')}
        confirmText={t('campaigns.dialogs.cancelConfirm')}
        variant="destructive"
      />
    </DashboardLayout>
  );
}
