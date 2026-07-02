/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@plunk/ui';
import {EmptyState} from '@plunk/ui';
import {DashboardLayout} from '../../components/DashboardLayout';
import {useAnalytics} from '../../lib/hooks/useAnalytics';
import {useTranslation} from '../../lib/i18n';
import useSWR from 'swr';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Eye,
  Mail,
  Megaphone,
  MousePointerClick,
  Send,
  Zap,
} from 'lucide-react';
import {NextSeo} from 'next-seo';
import {useMemo, useState} from 'react';
import {Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis} from 'recharts';

export default function AnalyticsPage() {
  const {t} = useTranslation();
  const [dateRange, setDateRange] = useState<string>('30');
  const days = parseInt(dateRange);

  // Chart configurations with sleek blue theme
  const volumeChartConfig = {
    emails: {
      label: t('analytics.charts.emailsSent'),
      color: 'hsl(221.2 83.2% 53.3%)', // Vibrant blue
    },
    opens: {
      label: t('analytics.charts.opens'),
      color: 'hsl(142.1 76.2% 36.3%)', // Green
    },
    clicks: {
      label: t('analytics.charts.clicks'),
      color: 'hsl(262.1 83.3% 57.8%)', // Purple
    },
  } satisfies ChartConfig;

  const engagementChartConfig = {
    openRate: {
      label: t('analytics.charts.openRate'),
      color: 'hsl(221.2 83.2% 53.3%)', // Vibrant blue to match
    },
  } satisfies ChartConfig;

  const {stats, timeSeries, isLoading, error} = useAnalytics({days});

  // Calculate start and end dates for additional API calls
  const {startDate, endDate} = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return {startDate: start.toISOString(), endDate: end.toISOString()};
  }, [days]);

    const {data: campaignStats} = useSWR<{
    total: number;
    active: number;
    completed: number;
    averageOpenRate: number;
    averageClickRate: number;
  }>(`/analytics/campaign-stats?startDate=${startDate}&endDate=${endDate}`, {
    revalidateOnFocus: false,
    refreshInterval: 300000,
    dedupingInterval: 10000,
  });

    const {data: topEvents} = useSWR<
    {
      name: string;
      count: number;
      trend: number;
    }[]
  >(`/analytics/top-events?limit=5&startDate=${startDate}&endDate=${endDate}`, {
    revalidateOnFocus: false,
    refreshInterval: 300000,
    dedupingInterval: 10000,
  });

    const {data: topCampaigns} = useSWR<
    {
      id: string;
      subject: string;
      sentCount: number;
      openedCount: number;
      clickedCount: number;
      openRate: number;
      clickRate: number;
    }[]
  >(`/analytics/top-campaigns?limit=10&startDate=${startDate}&endDate=${endDate}`, {
    revalidateOnFocus: false,
    refreshInterval: 300000,
    dedupingInterval: 10000,
  });

    const chartData = useMemo(() => {
    if (timeSeries && timeSeries.length > 0) {
      return timeSeries.map(point => ({
        date: new Date(point.date).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}),
        emails: point.emails,
        opens: point.opens,
        clicks: point.clicks,
        openRate: point.emails > 0 ? Number(((point.opens / point.emails) * 100).toFixed(1)) : 0,
      }));
    }

    // Return empty array if no data
    return [];
  }, [timeSeries]);

    const hasData = useMemo(() => {
    return chartData.some(point => point.emails > 0 || point.opens > 0 || point.clicks > 0);
  }, [chartData]);

    const cumulativeTotals = useMemo(() => {
    return chartData.reduce(
      (acc, day) => ({
        emails: acc.emails + (day.emails || 0),
        opens: acc.opens + (day.opens || 0),
        clicks: acc.clicks + (day.clicks || 0),
      }),
      {emails: 0, opens: 0, clicks: 0},
    );
  }, [chartData]);

  const statsCards = [
    {
      name: t('analytics.metrics.totalEmails'),
      value: stats?.totalEmailsSent?.toLocaleString() || cumulativeTotals.emails.toLocaleString(),
      icon: Send,
      description: t('analytics.metrics.lastNDays', {days}),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
      trend: stats?.totalEmailsSent ? (stats.totalEmailsSent > 0 ? 'positive' : 'neutral') : 'neutral',
    },
    {
      name: t('analytics.metrics.openRate'),
      value: stats?.openRate ? `${stats.openRate.toFixed(1)}%` : '0%',
      icon: Eye,
      description: t('analytics.metrics.opensCount', {
        count: stats?.totalEmailsOpened?.toLocaleString() || cumulativeTotals.opens.toLocaleString(),
      }),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
      trend: stats?.openRate && stats.openRate > 20 ? 'positive' : 'neutral',
    },
    {
      name: t('analytics.metrics.clickRate'),
      value: stats?.clickRate ? `${stats.clickRate.toFixed(1)}%` : '0%',
      icon: MousePointerClick,
      description: t('analytics.metrics.clicksCount', {
        count: stats?.totalEmailsClicked?.toLocaleString() || cumulativeTotals.clicks.toLocaleString(),
      }),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
      trend: stats?.clickRate && stats.clickRate > 3 ? 'positive' : 'neutral',
    },
    {
      name: t('analytics.metrics.activeCampaigns'),
      value: campaignStats?.active?.toLocaleString() || '0',
      icon: Megaphone,
      description: t('analytics.metrics.totalCampaigns', {count: campaignStats?.total || 0}),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
      trend: campaignStats?.active ? 'positive' : 'neutral',
    },
    {
      name: t('analytics.metrics.workflows'),
      value: stats?.totalWorkflowsStarted?.toLocaleString() || '0',
      icon: Activity,
      description: t('analytics.metrics.automationsTriggered'),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
      trend: stats?.totalWorkflowsStarted && stats.totalWorkflowsStarted > 0 ? 'positive' : 'neutral',
    },
    {
      name: t('analytics.metrics.totalEvents'),
      value: stats?.totalEvents?.toLocaleString() || '0',
      icon: Zap,
      description: t('analytics.metrics.customEventsTracked'),
      color: 'text-neutral-600',
      bgColor: 'bg-neutral-100',
      trend: stats?.totalEvents && stats.totalEvents > 0 ? 'positive' : 'neutral',
    },
  ];

  return (
    <>
      <NextSeo title={t('analytics.title')} />
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('analytics.title')}</h1>
              <p className="text-neutral-500 mt-2 text-sm sm:text-base">{t('analytics.subtitle')}</p>
            </div>
            <div className="flex gap-3">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder={t('analytics.ranges.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">{t('analytics.ranges.last7Days')}</SelectItem>
                  <SelectItem value="30">{t('analytics.ranges.last30Days')}</SelectItem>
                  <SelectItem value="90">{t('analytics.ranges.last90Days')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Error State */}
          {error && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 text-red-700">
                  <AlertCircle className="h-5 w-5" />
                  <span>{t('analytics.errors.loadFailed')}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                    <CardTitle className="text-2xl">{isLoading ? '-' : stat.value}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-neutral-500">{stat.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Email Volume Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.charts.volumeTitle')}</CardTitle>
              <CardDescription>{t('analytics.charts.volumeDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {!hasData ? (
                <div className="flex h-[400px] w-full items-center justify-center">
                  <EmptyState
                    className="py-0"
                    icon={Mail}
                    title={t('analytics.empty.noEmailTitle')}
                    description={t('analytics.empty.noEmailDescription')}
                  />
                </div>
              ) : (
                <ChartContainer config={volumeChartConfig} className="h-[400px] w-full">
                  <AreaChart data={chartData} margin={{top: 10, right: 30, left: 0, bottom: 0}}>
                    <defs>
                      <linearGradient id="fillEmails" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-emails)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-emails)" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="fillOpens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-opens)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-opens)" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="fillClicks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-clicks)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-clicks)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={32}
                      tick={{fontSize: 12}}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tick={{fontSize: 12}}
                      className="text-muted-foreground"
                      domain={[0, 'auto']}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          className="w-[180px]"
                          labelFormatter={(value: any) => {
                            return value;
                          }}
                        />
                      }
                    />
                    <Area
                      dataKey="emails"
                      type="monotone"
                      fill="url(#fillEmails)"
                      stroke="var(--color-emails)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: 'var(--color-emails)',
                        stroke: 'white',
                        strokeWidth: 2,
                      }}
                    />
                    <Area
                      dataKey="opens"
                      type="monotone"
                      fill="url(#fillOpens)"
                      stroke="var(--color-opens)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: 'var(--color-opens)',
                        stroke: 'white',
                        strokeWidth: 2,
                      }}
                    />
                    <Area
                      dataKey="clicks"
                      type="monotone"
                      fill="url(#fillClicks)"
                      stroke="var(--color-clicks)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: 'var(--color-clicks)',
                        stroke: 'white',
                        strokeWidth: 2,
                      }}
                    />
                    <ChartLegend content={<ChartLegendContent />} verticalAlign="top" height={36} />
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Engagement Rate Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.charts.engagementTitle')}</CardTitle>
              <CardDescription>{t('analytics.charts.engagementDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {!hasData ? (
                <div className="flex h-[300px] w-full items-center justify-center">
                  <EmptyState
                    className="py-0"
                    icon={Eye}
                    title={t('analytics.empty.noEngagementTitle')}
                    description={t('analytics.empty.noEngagementDescription')}
                  />
                </div>
              ) : (
                <ChartContainer config={engagementChartConfig} className="h-[300px] w-full">
                  <LineChart data={chartData} margin={{top: 20, right: 30, left: 0, bottom: 0}}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={32}
                      tick={{fontSize: 12}}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tick={{fontSize: 12}}
                      tickFormatter={value => `${value}%`}
                      className="text-muted-foreground"
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          className="w-[150px]"
                          labelFormatter={(value: any) => value}
                          formatter={(value: any) => [`${value}%`, t('analytics.charts.openRate')]}
                        />
                      }
                      cursor={{
                        stroke: 'hsl(var(--border))',
                        strokeWidth: 1,
                        strokeDasharray: '3 3',
                      }}
                    />
                    <Line
                      dataKey="openRate"
                      type="monotone"
                      stroke="var(--color-openRate)"
                      strokeWidth={2.5}
                      dot={{
                        fill: 'var(--color-openRate)',
                        stroke: 'white',
                        strokeWidth: 2,
                        r: 4,
                      }}
                      activeDot={{
                        r: 6,
                        fill: 'var(--color-openRate)',
                        stroke: 'white',
                        strokeWidth: 2,
                      }}
                    />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Key Insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.insights.title')}</CardTitle>
                <CardDescription>{t('analytics.insights.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-4 w-4 text-neutral-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{t('analytics.insights.openRate')}</p>
                    <p className="text-sm text-neutral-500">
                      {stats?.openRate && stats.openRate > 20
                        ? t('analytics.insights.openRateGood')
                        : t('analytics.insights.openRateBad')}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                    <BarChart3 className="h-4 w-4 text-neutral-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{t('analytics.insights.clickRate')}</p>
                    <p className="text-sm text-neutral-500">
                      {stats?.clickRate && stats.clickRate > 3
                        ? t('analytics.insights.clickRateGood')
                        : t('analytics.insights.clickRateBad')}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                    <Zap className="h-4 w-4 text-neutral-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{t('analytics.insights.engagement')}</p>
                    <p className="text-sm text-neutral-500">
                      {stats?.totalWorkflowsStarted
                        ? t('analytics.insights.workflowsStarted', {count: stats.totalWorkflowsStarted.toLocaleString()})
                        : t('analytics.insights.engagementBad')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.events.activityTitle')}</CardTitle>
                <CardDescription>{t('analytics.events.activityDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold text-neutral-900">{stats?.totalEvents?.toLocaleString() || '0'}</p>
                    <p className="text-sm text-neutral-500">{t('analytics.events.totalEvents')}</p>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-neutral-100 flex items-center justify-center">
                    <Zap className="h-6 w-6 text-neutral-600" />
                  </div>
                </div>
                <div className="pt-4 border-t">
                  <p className="text-sm text-neutral-500">{t('analytics.events.activityNote', {days})}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Campaign Performance */}
          {topCampaigns && topCampaigns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.campaigns.title')}</CardTitle>
                <CardDescription>{t('analytics.campaigns.description', {days})}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                          {t('analytics.campaigns.campaign')}
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          {t('analytics.campaigns.sent')}
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          {t('analytics.campaigns.opened')}
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          {t('analytics.campaigns.clicked')}
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          {t('analytics.campaigns.openRate')}
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          {t('analytics.campaigns.clickRate')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCampaigns.map((campaign, idx) => (
                        <tr key={campaign.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-6 h-6 rounded bg-neutral-100 text-neutral-600 font-semibold text-xs">
                                {idx + 1}
                              </div>
                              <span className="text-sm font-medium text-neutral-900">{campaign.subject}</span>
                            </div>
                          </td>
                          <td className="text-right py-3 px-4 text-sm text-neutral-600">
                            {campaign.sentCount.toLocaleString()}
                          </td>
                          <td className="text-right py-3 px-4 text-sm text-neutral-600">
                            {campaign.openedCount.toLocaleString()}
                          </td>
                          <td className="text-right py-3 px-4 text-sm text-neutral-600">
                            {campaign.clickedCount.toLocaleString()}
                          </td>
                          <td className="text-right py-3 px-4">
                            <span
                              className={`text-sm font-medium ${
                                campaign.openRate > 30 ? 'text-green-700' : 'text-neutral-700'
                              }`}
                            >
                              {campaign.openRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="text-right py-3 px-4">
                            <span
                              className={`text-sm font-medium ${
                                campaign.clickRate > 5 ? 'text-green-700' : 'text-neutral-700'
                              }`}
                            >
                              {campaign.clickRate.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Events */}
          {topEvents && topEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('analytics.events.topTitle')}</CardTitle>
                <CardDescription>{t('analytics.events.topDescription', {days})}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {topEvents.map((event, index) => (
                    <div key={event.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-100 text-neutral-600 font-semibold text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-neutral-900">{event.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('analytics.events.occurrences', {count: event.count.toLocaleString()})}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className={`text-xs font-medium px-2 py-1 rounded-full ${
                            event.trend > 0
                              ? 'bg-green-100 text-green-700'
                              : event.trend < 0
                                ? 'bg-red-100 text-red-700'
                                : 'bg-neutral-100 text-neutral-700'
                          }`}
                        >
                          {event.trend > 0 ? '+' : ''}
                          {event.trend}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DashboardLayout>
    </>
  );
}
