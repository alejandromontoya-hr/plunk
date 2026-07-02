import {Button, Card, CardContent, CardDescription, CardHeader, CardTitle} from '@plunk/ui';
import {AnimatePresence, motion} from 'framer-motion';
import {BookOpen, Check, CheckCircle2, Mail, MessageCircle, Shield, Users, Zap} from 'lucide-react';
import Link from 'next/link';
import {useMemo, useState} from 'react';
import {LANDING_URI, WIKI_URI} from '../lib/constants';
import type {ProjectSetupState} from '../lib/hooks/useProjectSetupState';
import {useConfig} from '../lib/hooks/useConfig';
import {useTranslation} from '../lib/i18n';

interface QuickStartStep {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  link: string;
  linkText: string;
  isCompleted: boolean;
}

interface QuickStartProps {
  setupState: ProjectSetupState | undefined;
  isLoading: boolean;
}

// Help resources that always appear
function HelpResources() {
  const {t} = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyEmail = () => {
    void navigator.clipboard.writeText('support@useplunk.com');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-6 pb-6 pt-4 border-t border-neutral-200">
      <p className="text-xs font-medium text-neutral-500 mb-3">{t('dashboard.quickStart.needHelp')}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button asChild variant="outline" size="sm" className="flex-1">
          <Link href={WIKI_URI} target="_blank">
            <BookOpen className="h-3.5 w-3.5" />
            {t('nav.documentation')}
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="flex-1">
          <Link href={`${LANDING_URI}/discord`} target="_blank">
            <MessageCircle className="h-3.5 w-3.5" />
            {t('dashboard.quickStart.joinDiscord')}
          </Link>
        </Button>
        <motion.button
          onClick={copyEmail}
          whileTap={{scale: 0.97}}
          className="flex-1 relative flex items-center justify-center gap-1.5 h-9 rounded-md border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 overflow-hidden transition-colors hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="copied"
                className="flex items-center gap-1.5"
                initial={{opacity: 0, y: 6}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -6}}
                transition={{duration: 0.15}}
              >
                <Check className="h-3.5 w-3.5 text-green-600" />
                <span className="text-green-600">{t('dashboard.quickStart.copied')}</span>
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                className="flex items-center gap-1.5"
                initial={{opacity: 0, y: 6}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -6}}
                transition={{duration: 0.15}}
              >
                <Mail className="h-3.5 w-3.5" />
                {t('dashboard.quickStart.emailSupport')}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
}

export function QuickStart({setupState, isLoading}: QuickStartProps) {
  const {t} = useTranslation();
  // Calculate days since last campaign using useMemo to avoid impure function during render
  // Must be called before any early returns to follow Rules of Hooks
  const daysSinceLastCampaign = useMemo(() => {
    if (!setupState || !setupState.lastCampaignSentAt) return null;
    const now = new Date();
    const lastSent = new Date(setupState.lastCampaignSentAt);
    return Math.floor((now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24));
  }, [setupState]);

  const {data: config} = useConfig();
  const billingEnabled = config?.features.billing.enabled ?? false;

  if (isLoading || !setupState) {
    return (
      <Card className="flex flex-col h-full">
        <CardHeader>
          <CardTitle>{t('dashboard.quickStart.title')}</CardTitle>
          <CardDescription>{t('dashboard.quickStart.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="flex items-start gap-4 p-4 rounded-lg border border-neutral-200 bg-neutral-50/50 animate-pulse"
              >
                <div className="h-10 w-10 rounded-lg bg-neutral-200" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-neutral-200 rounded w-1/3" />
                  <div className="h-3 bg-neutral-200 rounded w-2/3" />
                </div>
                <div className="h-9 w-20 bg-neutral-200 rounded-lg" />
              </div>
            ))}
          </div>
        </CardContent>
        <HelpResources />
      </Card>
    );
  }

  const hasContacts = setupState.contactCount > 0;
  const hasSentCampaign = setupState.lastCampaignSentAt !== null;
  const hasRecentCampaign = daysSinceLastCampaign !== null && daysSinceLastCampaign <= 30;

  // Build dynamic steps based on setup state with proper prioritization
  // Priority order: Domain → Contacts → Campaign → Workflow → Subscription
  const allSteps: QuickStartStep[] = [];

  // Priority 1: Domain verification (critical for deliverability)
  if (!setupState.hasVerifiedDomain) {
    allSteps.push({
      id: 'domain',
      icon: Shield,
      title: t('dashboard.quickStart.domain.title'),
      description: t('dashboard.quickStart.domain.description'),
      link: '/settings?tab=domains',
      linkText: t('dashboard.quickStart.domain.linkText'),
      isCompleted: false,
    });
  }

  // Priority 2: Add contacts (can't send without contacts)
  if (!hasContacts) {
    allSteps.push({
      id: 'contacts',
      icon: Users,
      title: t('dashboard.quickStart.contacts.title'),
      description: t('dashboard.quickStart.contacts.description'),
      link: '/contacts',
      linkText: t('dashboard.quickStart.contacts.linkText'),
      isCompleted: false,
    });
  }

  // Priority 3: Send campaign (core functionality, show if they have contacts but never sent)
  if (hasContacts && !hasSentCampaign) {
    allSteps.push({
      id: 'campaign',
      icon: Mail,
      title: t('dashboard.quickStart.campaign.title'),
      description: t('dashboard.quickStart.campaign.description'),
      link: '/campaigns',
      linkText: t('dashboard.quickStart.campaign.linkText'),
      isCompleted: false,
    });
  }

  // Priority 4: Set up automation (advanced feature, only show if no workflow and have contacts)
  if (hasContacts && !setupState.hasEnabledWorkflow) {
    allSteps.push({
      id: 'workflows',
      icon: Zap,
      title: t('dashboard.quickStart.workflows.title'),
      description: t('dashboard.quickStart.workflows.description'),
      link: '/workflows',
      linkText: t('dashboard.quickStart.workflows.linkText'),
      isCompleted: false,
    });
  }

  // Priority 5: Subscription (nice to have, lower priority)
  if (billingEnabled && !setupState.hasSubscription) {
    allSteps.push({
      id: 'subscription',
      icon: Shield,
      title: t('dashboard.quickStart.subscription.title'),
      description: t('dashboard.quickStart.subscription.description'),
      link: '/settings?tab=billing',
      linkText: t('dashboard.quickStart.subscription.linkText'),
      isCompleted: false,
    });
  }

  // Priority 6: Re-engagement (show if they've been inactive)
  if (hasSentCampaign && !hasRecentCampaign && daysSinceLastCampaign !== null && daysSinceLastCampaign > 30) {
    allSteps.push({
      id: 'campaign-reengagement',
      icon: Mail,
      title: t('dashboard.quickStart.reengagement.title'),
      description: t('dashboard.quickStart.reengagement.description', {days: daysSinceLastCampaign ?? 0}),
      link: '/campaigns',
      linkText: t('dashboard.quickStart.campaign.linkText'),
      isCompleted: false,
    });
  }

  // If core setup is complete and they're actively sending, show success message
  if (setupState.hasVerifiedDomain && hasContacts && hasSentCampaign && hasRecentCampaign) {
    return (
      <Card className="flex flex-col h-full">
        <CardHeader>
          <CardTitle>{t('dashboard.quickStart.title')}</CardTitle>
          <CardDescription>{t('dashboard.quickStart.fullySetUp')}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-start gap-4 p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="h-10 w-10 rounded-lg bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-green-700" />
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-semibold text-green-900 mb-1">{t('dashboard.quickStart.allSet')}</p>
              <p className="text-xs text-green-700 leading-relaxed">
                {t('dashboard.quickStart.allSetDescription')}
              </p>
            </div>
          </div>
        </CardContent>
        <HelpResources />
      </Card>
    );
  }

  // Show only the first 3 most important steps
  const visibleSteps = allSteps.slice(0, 3);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle>{t('dashboard.quickStart.title')}</CardTitle>
        <CardDescription>
          {visibleSteps.length === 0
            ? t('dashboard.quickStart.projectSetUp')
            : t('dashboard.quickStart.subtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-3">
          {visibleSteps.map(step => {
            const Icon = step.icon;
            return (
              <div
                key={step.id}
                className="group relative flex items-start gap-4 p-4 rounded-lg border border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50 hover:border-neutral-300 transition-all duration-200"
              >
                <div
                  className={`h-10 w-10 rounded-lg ${step.isCompleted ? 'bg-green-100 border border-green-200' : 'bg-white border border-neutral-200'} flex items-center justify-center flex-shrink-0 transition-colors`}
                >
                  <Icon
                    className={`h-5 w-5 ${step.isCompleted ? 'text-green-700' : 'text-neutral-600'} transition-colors`}
                  />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-sm font-semibold text-neutral-900">{step.title}</p>
                    {step.isCompleted && <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />}
                  </div>
                  <p className="text-xs text-neutral-600 leading-relaxed">{step.description}</p>
                </div>
                <Button asChild size="sm" variant={step.isCompleted ? 'outline' : 'default'} className="flex-shrink-0">
                  <Link href={step.link}>{step.linkText}</Link>
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
      <HelpResources />
    </Card>
  );
}
