import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  IconSpinner,
  Input,
  Label,
} from '@plunk/ui';
import type {Contact} from '@plunk/db';
import {AnimatePresence, motion} from 'framer-motion';
import {ArrowLeft, Check, Copy, Database, ExternalLink, Save, Settings, Trash2} from 'lucide-react';
import Link from 'next/link';
import {NextSeo} from 'next-seo';
import {useRouter} from 'next/router';
import {useEffect, useState} from 'react';
import {DashboardLayout} from '../../components/DashboardLayout';
import {KeyValueEditor} from '../../components/KeyValueEditor';
import {ActivityFeed} from '../../components/ActivityFeed';
import {ContactTopicSubscriptions} from '../../components/ContactTopicSubscriptions';
import {network} from '../../lib/network';
import {useTranslation} from '../../lib/i18n';
import {toast} from 'sonner';
import useSWR from 'swr';
import dayjs from 'dayjs';

export default function ContactDetailPage() {
  const {t} = useTranslation();
  const router = useRouter();
  const {id} = router.query;
  const {data: contact, mutate, isLoading} = useSWR<Contact>(id ? `/contacts/${id}` : null);

  const [email, setEmail] = useState('');
  const [customData, setCustomData] = useState<Record<string, string | number | boolean> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (contact) {
      setEmail(contact.email);
      setCustomData(contact.data as Record<string, string | number | boolean> | null);
    }
  }, [contact]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await network.fetch<{success: boolean}>('PATCH', `/contacts/${id}`, {email, data: customData} as never);
      toast.success(t('contacts.toast.updated'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contacts.toast.updateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await network.fetch('DELETE', `/contacts/${id}`);
      toast.success(t('contacts.toast.deleted'));
      void router.push('/contacts');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contacts.toast.deleteFailed'));
    }
  };

  const copyToClipboard = async (text: string, label: string, copyId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(copyId);
      setTimeout(() => setCopiedId(null), 2000);
      toast.success(t('contacts.toast.copied', {label}));
    } catch {
      toast.error(t('contacts.toast.copyFailed'));
    }
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

  if (!contact) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-neutral-900 mb-2">{t('contacts.detail.notFoundTitle')}</h3>
          <p className="text-neutral-500 mb-6">
            {t('contacts.detail.notFoundDescription')}
          </p>
          <Button asChild>
            <Link href="/contacts">
              <ArrowLeft className="h-4 w-4" />
              {t('contacts.detail.backToContacts')}
            </Link>
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <>
      <NextSeo title={contact.email} />
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Button asChild variant="outline" size="sm">
                <Link href="/contacts"><ArrowLeft className="h-4 w-4" /></Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 truncate">{contact.email}</h1>
                <p className="mt-1">
                  <span
                    className={`inline-flex items-center px-2 sm:px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      contact.subscribed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {contact.subscribed ? t('contacts.status.subscribed') : t('contacts.status.unsubscribed')}
                  </span>
                </p>
              </div>
            </div>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)} className="flex-shrink-0">
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">{t('contacts.detail.deleteContact')}</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Edit Form */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('contacts.detail.contactInformation')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="email">{t('contacts.detail.emailLabel')}</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        placeholder={t('contacts.detail.emailPlaceholder')}
                      />
                    </div>

                    <div>
                      {contact && (
                        <KeyValueEditor
                          key={`${contact.id}-${JSON.stringify(contact.data)}`}
                          initialData={contact.data as Record<string, string | number | boolean> | null}
                          onChange={setCustomData}
                        />
                      )}
                    </div>

                    <Button type="submit" disabled={isSubmitting}>
                      <Save className="h-4 w-4" />
                      {isSubmitting ? t('contacts.detail.saving') : t('contacts.detail.saveChanges')}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Per-topic subscriptions */}
              <ContactTopicSubscriptions contactId={id as string} onChanged={() => void mutate()} />

              {/* Activity Feed */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('contacts.detail.activity')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityFeed contactId={id as string} />
                </CardContent>
              </Card>
            </div>

            {/* Metadata Sidebar */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('contacts.detail.details')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Database className="h-5 w-5 text-neutral-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-900">{t('contacts.detail.contactId')}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-xs text-neutral-500 font-mono break-all flex-1">{contact.id}</p>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(contact.id, t('contacts.detail.labels.contactId'), 'contact-id')}
                          className="flex-shrink-0 text-neutral-400 hover:text-neutral-700 transition-colors"
                          aria-label={t('contacts.detail.copyContactId')}
                        >
                          <AnimatePresence mode="wait" initial={false}>
                            {copiedId === 'contact-id' ? (
                              <motion.span
                                key="copied"
                                initial={{opacity: 0, y: 4}}
                                animate={{opacity: 1, y: 0}}
                                exit={{opacity: 0, y: -4}}
                                transition={{duration: 0.15}}
                              >
                                <Check className="h-3 w-3 text-green-600" />
                              </motion.span>
                            ) : (
                              <motion.span
                                key="idle"
                                initial={{opacity: 0, y: 4}}
                                animate={{opacity: 1, y: 0}}
                                exit={{opacity: 0, y: -4}}
                                transition={{duration: 0.15}}
                              >
                                <Copy className="h-3 w-3" />
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-neutral-900">{t('contacts.detail.created')}</p>
                    <div className="group relative inline-block cursor-help">
                      <p className="text-sm text-neutral-500">{dayjs(contact.createdAt).fromNow()}</p>
                      <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-0 mb-1 whitespace-nowrap">
                        {dayjs(contact.createdAt).format('DD MMMM YYYY, hh:mm')}
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-neutral-900">{t('contacts.detail.lastUpdated')}</p>
                    <div className="group relative inline-block cursor-help">
                      <p className="text-sm text-neutral-500">{dayjs(contact.updatedAt).fromNow()}</p>
                      <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-0 mb-1 whitespace-nowrap">
                        {dayjs(contact.updatedAt).format('DD MMMM YYYY, hh:mm')}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Public Links Card */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('contacts.detail.publicLinks')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-neutral-700">{t('contacts.detail.subscribePage')}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-start text-xs"
                        onClick={() => window.open(`${window.location.origin}/subscribe/${contact.id}`, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t('common.open')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="overflow-hidden"
                        onClick={() =>
                          copyToClipboard(
                            `${window.location.origin}/subscribe/${contact.id}`,
                            t('contacts.detail.labels.subscribeLink'),
                            'subscribe',
                          )
                        }
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {copiedId === 'subscribe' ? (
                            <motion.span
                              key="copied"
                              initial={{opacity: 0, y: 4}}
                              animate={{opacity: 1, y: 0}}
                              exit={{opacity: 0, y: -4}}
                              transition={{duration: 0.15}}
                            >
                              <Check className="h-3 w-3 text-green-600" />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="idle"
                              initial={{opacity: 0, y: 4}}
                              animate={{opacity: 1, y: 0}}
                              exit={{opacity: 0, y: -4}}
                              transition={{duration: 0.15}}
                            >
                              <Copy className="h-3 w-3" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-neutral-700">{t('contacts.detail.unsubscribePage')}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-start text-xs"
                        onClick={() => window.open(`${window.location.origin}/unsubscribe/${contact.id}`, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t('common.open')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="overflow-hidden"
                        onClick={() =>
                          copyToClipboard(
                            `${window.location.origin}/unsubscribe/${contact.id}`,
                            t('contacts.detail.labels.unsubscribeLink'),
                            'unsubscribe',
                          )
                        }
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {copiedId === 'unsubscribe' ? (
                            <motion.span
                              key="copied"
                              initial={{opacity: 0, y: 4}}
                              animate={{opacity: 1, y: 0}}
                              exit={{opacity: 0, y: -4}}
                              transition={{duration: 0.15}}
                            >
                              <Check className="h-3 w-3 text-green-600" />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="idle"
                              initial={{opacity: 0, y: 4}}
                              animate={{opacity: 1, y: 0}}
                              exit={{opacity: 0, y: -4}}
                              transition={{duration: 0.15}}
                            >
                              <Copy className="h-3 w-3" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-neutral-700">{t('contacts.detail.managePreferences')}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-start text-xs"
                        onClick={() => window.open(`${window.location.origin}/manage/${contact.id}`, '_blank')}
                      >
                        <Settings className="h-3 w-3" />
                        {t('common.open')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="overflow-hidden"
                        onClick={() =>
                          copyToClipboard(
                            `${window.location.origin}/manage/${contact.id}`,
                            t('contacts.detail.labels.managePreferencesLink'),
                            'manage',
                          )
                        }
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {copiedId === 'manage' ? (
                            <motion.span
                              key="copied"
                              initial={{opacity: 0, y: 4}}
                              animate={{opacity: 1, y: 0}}
                              exit={{opacity: 0, y: -4}}
                              transition={{duration: 0.15}}
                            >
                              <Check className="h-3 w-3 text-green-600" />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="idle"
                              initial={{opacity: 0, y: 4}}
                              animate={{opacity: 1, y: 0}}
                              exit={{opacity: 0, y: -4}}
                              transition={{duration: 0.15}}
                            >
                              <Copy className="h-3 w-3" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={handleDelete}
          title={t('contacts.deleteDialog.title')}
          description={t('contacts.deleteDialog.description')}
          confirmText={t('common.delete')}
          variant="destructive"
        />
      </DashboardLayout>
    </>
  );
}
