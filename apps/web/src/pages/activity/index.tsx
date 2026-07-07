import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@plunk/ui';
import {DashboardLayout} from '../../components/DashboardLayout';
import {ActivityFeed} from '../../components/ActivityFeed';
import {useTranslation} from '../../lib/i18n';
import {Eye, MousePointerClick, Send, Zap} from 'lucide-react';
import {NextSeo} from 'next-seo';
import {useQueryState, parseAsString} from 'nuqs';
import useSWR from 'swr';

interface ActivityStats {
  totalEvents: number;
  totalEmailsSent: number;
  totalEmailsOpened: number;
  totalEmailsClicked: number;
  totalWorkflowsStarted: number;
  openRate: number;
  clickRate: number;
}

export default function ActivityPage() {
  const {t} = useTranslation();
  const [typeFilter, setTypeFilter] = useQueryState('type', parseAsString.withDefault('ALL'));
  const [dateRange, setDateRange] = useQueryState('days', parseAsString.withDefault('30'));

  // Fetch activity stats
  const {data: stats} = useSWR<ActivityStats>(`/activity/stats`, {
    revalidateOnFocus: false,
  });

  const statsCards = [
    {
      name: t('activity.stats.eventsTriggered'),
      value: stats?.totalEvents?.toLocaleString() || '0',
      icon: Zap,
      description: t('activity.stats.last30Days'),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
    },
    {
      name: t('activity.stats.emailsSent'),
      value: stats?.totalEmailsSent?.toLocaleString() || '0',
      icon: Send,
      description: t('activity.stats.last30Days'),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
    },
    {
      name: t('activity.stats.openRate'),
      value: stats?.openRate ? `${stats.openRate.toFixed(1)}%` : '0%',
      icon: Eye,
      description: t('activity.stats.opens', {count: stats?.totalEmailsOpened?.toLocaleString() || '0'}),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
    },
    {
      name: t('activity.stats.clickRate'),
      value: stats?.clickRate ? `${stats.clickRate.toFixed(1)}%` : '0%',
      icon: MousePointerClick,
      description: t('activity.stats.clicks', {count: stats?.totalEmailsClicked?.toLocaleString() || '0'}),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
    },
  ];

  return (
    <>
      <NextSeo title={t('activity.title')} />
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('activity.title')}</h1>
            <p className="text-neutral-500 mt-2 text-sm sm:text-base">{t('activity.subtitle')}</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {statsCards.map(stat => {
              const Icon = stat.icon;
              return (
                <Card key={stat.name}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardDescription>{stat.name}</CardDescription>
                      <div className={`h-10 w-10 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                        <Icon className={`h-5 w-5 ${stat.color}`} />
                      </div>
                    </div>
                    <CardTitle className="text-2xl">{stat.value}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-neutral-500">{stat.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('activity.filters.allActivityTypes')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{t('activity.filters.allActivityTypes')}</SelectItem>
                      <SelectItem value="event.triggered">{t('activity.filters.events')}</SelectItem>
                      <SelectItem value="email.sent,email.delivered,email.received,email.opened,email.clicked,email.bounced,email.complaint">
                        {t('activity.filters.emails')}
                      </SelectItem>
                      <SelectItem value="email.sent">{t('activity.filters.emailsSent')}</SelectItem>
                      <SelectItem value="email.delivered">{t('activity.filters.emailsDelivered')}</SelectItem>
                      <SelectItem value="email.received">{t('activity.filters.emailsReceived')}</SelectItem>
                      <SelectItem value="email.opened">{t('activity.filters.emailsOpened')}</SelectItem>
                      <SelectItem value="email.clicked">{t('activity.filters.emailsClicked')}</SelectItem>
                      <SelectItem value="email.bounced">{t('activity.filters.emailsBounced')}</SelectItem>
                      <SelectItem value="email.complaint">{t('activity.filters.emailComplaints')}</SelectItem>
                      <SelectItem value="workflow.started,workflow.completed">{t('activity.filters.workflows')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Select value={dateRange} onValueChange={setDateRange}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('activity.filters.last30Days')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t('activity.filters.last24Hours')}</SelectItem>
                      <SelectItem value="7">{t('activity.filters.last7Days')}</SelectItem>
                      <SelectItem value="30">{t('activity.filters.last30Days')}</SelectItem>
                      <SelectItem value="90">{t('activity.filters.last90Days')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card>
            <CardHeader>
              <CardTitle>{t('activity.feed.title')}</CardTitle>
              <CardDescription>{t('activity.feed.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityFeed
                typeFilter={typeFilter === 'ALL' ? undefined : typeFilter}
                dateRangeDays={parseInt(dateRange)}
              />
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    </>
  );
}
