import {Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger} from '@plunk/ui';
import type {Activity} from '@plunk/types';
import {memo, useState} from 'react';
import {useTranslation, type TranslateFn} from '../lib/i18n';
import {EmailPreviewModal} from './EmailPreviewModal';
import {
  AlertCircle,
  Calendar,
  CheckCheck,
  CheckCircle,
  ChevronRight,
  Eye,
  Inbox,
  MousePointerClick,
  Send,
  ShieldAlert,
  Workflow,
  XCircle,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

/**
 * Simple relative time formatter for past events
 */
function getRelativeTime(date: Date, t: TranslateFn): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return t('activity.time.justNow');
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return t(diffInMinutes === 1 ? 'activity.time.minuteAgo' : 'activity.time.minutesAgo', {count: diffInMinutes});
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return t(diffInHours === 1 ? 'activity.time.hourAgo' : 'activity.time.hoursAgo', {count: diffInHours});
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return t(diffInDays === 1 ? 'activity.time.dayAgo' : 'activity.time.daysAgo', {count: diffInDays});
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return t(diffInMonths === 1 ? 'activity.time.monthAgo' : 'activity.time.monthsAgo', {count: diffInMonths});
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  return t(diffInYears === 1 ? 'activity.time.yearAgo' : 'activity.time.yearsAgo', {count: diffInYears});
}

/**
 * Format upcoming time (for future events)
 */
function getUpcomingTime(date: Date, t: TranslateFn, locale: string): string {
  const now = new Date();
  const diffInSeconds = Math.floor((date.getTime() - now.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return t('activity.time.inAMoment');
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return t(diffInMinutes === 1 ? 'activity.time.inMinute' : 'activity.time.inMinutes', {count: diffInMinutes});
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return t(diffInHours === 1 ? 'activity.time.inHour' : 'activity.time.inHours', {count: diffInHours});
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays === 1) {
    return t('activity.time.tomorrowAt', {
      time: date.toLocaleTimeString(locale, {hour: 'numeric', minute: '2-digit', hour12: true}),
    });
  }

  if (diffInDays < 7) {
    return t('activity.time.inDays', {count: diffInDays});
  }

  if (diffInDays < 30) {
    const weeks = Math.floor(diffInDays / 7);
    return t(weeks === 1 ? 'activity.time.inWeek' : 'activity.time.inWeeks', {count: weeks});
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  return t(diffInMonths === 1 ? 'activity.time.inMonth' : 'activity.time.inMonths', {count: diffInMonths});
}

/**
 * Check if an activity is an email activity
 */
function isEmailActivity(type: string): boolean {
  return [
    'email.sent',
    'email.delivered',
    'email.received',
    'email.opened',
    'email.clicked',
    'email.bounced',
    'email.complaint',
  ].includes(type);
}

interface ActivityItemProps {
  activity: Activity;
  status?: 'upcoming' | 'completed';
}

interface ActivityConfig {
  icon: React.ComponentType<{className?: string}>;
  color: string;
  bgColor: string;
  title: string;
  description?: string;
  badge?: {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  };
  jsonData?: Record<string, unknown>;
}

function getActivityConfig(activity: Activity, t: TranslateFn): ActivityConfig {
  const {type, metadata} = activity;

  switch (type) {
    case 'event.triggered':
      return {
        icon: Zap,
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        title:
          (typeof metadata.eventName === 'string' ? metadata.eventName : undefined) ||
          t('activity.eventTypes.eventTriggered'),
        description: undefined,
        badge: {
          label: t('activity.eventTypes.event'),
          variant: 'default',
        },
        jsonData:
          metadata.eventData && typeof metadata.eventData === 'object' && !Array.isArray(metadata.eventData)
            ? (metadata.eventData as Record<string, unknown>)
            : undefined,
      };

    case 'email.sent':
      return {
        icon: Send,
        color: 'text-neutral-700',
        bgColor: 'bg-neutral-100',
        title: (typeof metadata.subject === 'string' ? metadata.subject : undefined) || t('activity.eventTypes.emailSent'),
        description: metadata.campaignName
          ? t('activity.descriptions.campaign', {name: String(metadata.campaignName)})
          : metadata.workflowName
            ? t('activity.descriptions.workflow', {name: String(metadata.workflowName)})
            : typeof metadata.sourceType === 'string'
              ? metadata.sourceType
              : undefined,
        badge: {
          label: t('activity.eventTypes.sent'),
          variant: 'default',
        },
      };

    case 'email.delivered':
      return {
        icon: CheckCircle,
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-50',
        title:
          (typeof metadata.subject === 'string' ? metadata.subject : undefined) ||
          t('activity.eventTypes.emailDelivered'),
        description: metadata.campaignName
          ? t('activity.descriptions.campaign', {name: String(metadata.campaignName)})
          : metadata.workflowName
            ? t('activity.descriptions.workflow', {name: String(metadata.workflowName)})
            : undefined,
        badge: {
          label: t('activity.eventTypes.delivered'),
          variant: 'default',
        },
      };

    case 'email.received':
      return {
        icon: Inbox,
        color: 'text-neutral-600',
        bgColor: 'bg-neutral-100',
        title:
          (typeof metadata.subject === 'string' ? metadata.subject : undefined) ||
          t('activity.eventTypes.emailReceived'),
        description:
          typeof metadata.from === 'string'
            ? t('activity.descriptions.from', {from: metadata.from})
            : t('activity.eventTypes.inboundEmail'),
        badge: {
          label: t('activity.eventTypes.received'),
          variant: 'default',
        },
      };

    case 'email.opened':
      return {
        icon: Eye,
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-50',
        title:
          (typeof metadata.subject === 'string' ? metadata.subject : undefined) || t('activity.eventTypes.emailOpened'),
        description:
          typeof metadata.totalOpens === 'number' && metadata.totalOpens > 1
            ? t('activity.descriptions.openedTimes', {count: metadata.totalOpens})
            : metadata.campaignName
              ? t('activity.descriptions.campaign', {name: String(metadata.campaignName)})
              : metadata.workflowName
                ? t('activity.descriptions.workflow', {name: String(metadata.workflowName)})
                : undefined,
        badge: {
          label: t('activity.eventTypes.opened'),
          variant: 'secondary',
        },
      };

    case 'email.clicked':
      return {
        icon: MousePointerClick,
        color: 'text-sky-700',
        bgColor: 'bg-sky-50',
        title:
          (typeof metadata.subject === 'string' ? metadata.subject : undefined) || t('activity.eventTypes.emailClicked'),
        description:
          typeof metadata.totalClicks === 'number' && metadata.totalClicks > 1
            ? t('activity.descriptions.clickedTimes', {count: metadata.totalClicks})
            : metadata.campaignName
              ? t('activity.descriptions.campaign', {name: String(metadata.campaignName)})
              : metadata.workflowName
                ? t('activity.descriptions.workflow', {name: String(metadata.workflowName)})
                : undefined,
        badge: {
          label: t('activity.eventTypes.clicked'),
          variant: 'default',
        },
      };

    case 'email.bounced':
      return {
        icon: XCircle,
        color: 'text-red-700',
        bgColor: 'bg-red-50',
        title:
          (typeof metadata.subject === 'string' ? metadata.subject : undefined) || t('activity.eventTypes.emailBounced'),
        description:
          (typeof metadata.error === 'string' ? metadata.error : undefined) ||
          t('activity.eventTypes.failedToDeliver'),
        badge: {
          label: t('activity.eventTypes.bounced'),
          variant: 'destructive',
        },
      };

    case 'email.complaint':
      return {
        icon: ShieldAlert,
        color: 'text-red-700',
        bgColor: 'bg-red-50',
        title:
          (typeof metadata.subject === 'string' ? metadata.subject : undefined) ||
          t('activity.eventTypes.spamComplaint'),
        description: metadata.campaignName
          ? t('activity.descriptions.campaign', {name: String(metadata.campaignName)})
          : metadata.workflowName
            ? t('activity.descriptions.workflow', {name: String(metadata.workflowName)})
            : t('activity.eventTypes.markedAsSpam'),
        badge: {
          label: t('activity.eventTypes.complaint'),
          variant: 'destructive',
        },
      };

    case 'workflow.started':
      return {
        icon: Workflow,
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        title:
          (typeof metadata.workflowName === 'string' ? metadata.workflowName : undefined) ||
          t('activity.eventTypes.workflowStarted'),
        description: t('activity.descriptions.status', {
          status: String(metadata.status || t('activity.descriptions.unknownStatus')),
        }),
        badge: {
          label: t('activity.eventTypes.workflow'),
          variant: 'default',
        },
      };

    case 'workflow.completed':
      return {
        icon: CheckCheck,
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        title:
          (typeof metadata.workflowName === 'string' ? metadata.workflowName : undefined) ||
          t('activity.eventTypes.workflowCompleted'),
        description: metadata.exitReason
          ? t('activity.descriptions.exit', {reason: String(metadata.exitReason)})
          : t('activity.descriptions.status', {
              status: String(metadata.status || t('activity.descriptions.unknownStatus')),
            }),
        badge: {
          label: t('activity.eventTypes.completed'),
          variant: 'default',
        },
      };

    case 'campaign.scheduled':
      return {
        icon: Calendar,
        color: 'text-sky-700',
        bgColor: 'bg-sky-50',
        title:
          (typeof metadata.campaignName === 'string' ? metadata.campaignName : undefined) ||
          t('activity.eventTypes.campaignScheduled'),
        description: metadata.subject
          ? metadata.totalRecipients
            ? t('activity.descriptions.subjectWithRecipients', {
                subject: String(metadata.subject),
                count: Number(metadata.totalRecipients),
              })
            : String(metadata.subject)
          : metadata.totalRecipients
            ? t('activity.descriptions.recipients', {count: Number(metadata.totalRecipients)})
            : undefined,
        badge: {
          label: t('activity.eventTypes.scheduled'),
          variant: 'outline',
        },
      };

    case 'workflow.email.scheduled':
      return {
        icon: Calendar,
        color: 'text-amber-700',
        bgColor: 'bg-amber-50',
        title:
          (typeof metadata.stepName === 'string' ? metadata.stepName : undefined) ||
          t('activity.eventTypes.workflowEmailScheduled'),
        description: metadata.workflowName
          ? metadata.subject
            ? t('activity.descriptions.workflowWithSubject', {
                name: String(metadata.workflowName),
                subject: String(metadata.subject),
              })
            : t('activity.descriptions.workflow', {name: String(metadata.workflowName)})
          : typeof metadata.subject === 'string'
            ? metadata.subject
            : undefined,
        badge: {
          label: t('activity.eventTypes.scheduled'),
          variant: 'outline',
        },
      };

    default:
      return {
        icon: AlertCircle,
        color: 'text-neutral-600',
        bgColor: 'bg-neutral-100',
        title: t('activity.eventTypes.unknownActivity'),
        badge: {
          label: t('activity.eventTypes.unknown'),
          variant: 'outline',
        },
      };
  }
}

export const ActivityItem = memo(function ActivityItem({activity, status = 'completed'}: ActivityItemProps) {
  const {t, locale} = useTranslation();
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const config = getActivityConfig(activity, t);
  const Icon = config.icon;
  const timestamp = new Date(activity.timestamp);
  const isUpcoming = status === 'upcoming';
  const relativeTime = isUpcoming ? getUpcomingTime(timestamp, t, locale) : getRelativeTime(timestamp, t);

  return (
    <div className={`flex items-start gap-4 ${isUpcoming ? 'opacity-80' : ''}`}>
      {/* Icon */}
      <div
        className={`h-10 w-10 rounded-lg ${config.bgColor} flex items-center justify-center flex-shrink-0 ${isUpcoming ? 'border-2 border-dashed border-neutral-300' : ''}`}
      >
        <Icon className={`h-5 w-5 ${config.color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className={`text-sm font-medium truncate ${isUpcoming ? 'text-neutral-700' : 'text-neutral-900'}`}>
                {config.title}
              </p>
              {config.badge && <Badge variant={config.badge.variant}>{config.badge.label}</Badge>}
              {isEmailActivity(activity.type) && activity.metadata.subject && activity.metadata.body ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreviewModal(true)}
                  className="h-6 px-2 text-xs"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  {t('activity.item.preview')}
                </Button>
              ) : null}
            </div>
            {config.description && <p className="text-sm text-neutral-500 line-clamp-2">{config.description}</p>}
            {activity.contactEmail && (
              <div className="flex items-center gap-2 mt-2">
                {activity.contactId ? (
                  <Link
                    href={`/contacts/${activity.contactId}`}
                    className="text-xs text-neutral-600 hover:text-neutral-900 hover:underline"
                  >
                    {activity.contactEmail}
                  </Link>
                ) : (
                  <span className="text-xs text-neutral-600">{activity.contactEmail}</span>
                )}
              </div>
            )}
            {/* Collapsible JSON Data */}
            {config.jsonData && (
              <Collapsible className="mt-2">
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-900 transition-colors group">
                  <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="font-medium">{t('activity.item.eventData')}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 p-3 bg-neutral-50 rounded-md border border-neutral-200 text-xs overflow-x-auto">
                    <code className="text-neutral-700">{JSON.stringify(config.jsonData, null, 2)}</code>
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
          <span
            className={`text-xs flex-shrink-0 whitespace-nowrap ${isUpcoming ? 'text-neutral-700 font-medium' : 'text-neutral-400'}`}
            title={timestamp.toLocaleString()}
          >
            {relativeTime}
          </span>
        </div>
      </div>

      {/* Email Preview Modal */}
      {showPreviewModal && activity.metadata.subject && activity.metadata.body ? (
        <EmailPreviewModal
          open={showPreviewModal}
          onOpenChange={setShowPreviewModal}
          subject={String(activity.metadata.subject)}
          body={String(activity.metadata.body)}
          from={activity.metadata.from ? String(activity.metadata.from) : undefined}
          fromName={activity.metadata.fromName ? String(activity.metadata.fromName) : undefined}
          replyTo={activity.metadata.replyTo ? String(activity.metadata.replyTo) : undefined}
          toName={activity.metadata.toName ? String(activity.metadata.toName) : undefined}
          toEmail={activity.contactEmail}
        />
      ) : null}
    </div>
  );
});
