import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  IconSpinner,
  Input,
  Label,
} from '@plunk/ui';
import type {Contact, Segment} from '@plunk/db';
import type {PaginatedResponse} from '@plunk/types';
import {DashboardLayout} from '../../components/DashboardLayout';
import {network} from '../../lib/network';
import {useTranslation} from '../../lib/i18n';
import {ArrowLeft, Database, Filter, Layers, MailCheck, MailX, RefreshCw, Save, Trash2, UserMinus, Users} from 'lucide-react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import {NextSeo} from 'next-seo';
import type {FilterCondition} from '@plunk/types';
import {SegmentSchemas} from '@plunk/shared';
import {SegmentFilterBuilder} from '../../components/SegmentFilterBuilder';
import {ContactPicker} from '../../components/ContactPicker';
import dayjs from 'dayjs';

type SegmentType = 'DYNAMIC' | 'STATIC';
type SegmentWithType = Segment & {type: SegmentType};

// Count total filters in a condition (recursive)
function countFilters(condition: FilterCondition): number {
  let count = 0;
  for (const group of condition.groups) {
    count += group.filters.length;
    if (group.conditions) {
      count += countFilters(group.conditions);
    }
  }
  return count;
}

export default function SegmentDetailPage() {
  const {t} = useTranslation();
  const router = useRouter();
  const {id} = router.query;

  const {data: segment, mutate, isLoading} = useSWR<SegmentWithType>(id ? `/segments/${id}` : null);
  const [contactsPage, setContactsPage] = useState(1);
  const {
    data: contactsData,
    isLoading: isLoadingContacts,
    mutate: mutateContacts,
  } = useSWR<PaginatedResponse<Contact>>(id ? `/segments/${id}/contacts?page=${contactsPage}&pageSize=10` : null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trackMembership, setTrackMembership] = useState(false);
  const [condition, setCondition] = useState<FilterCondition>({
    logic: 'AND',
    groups: [{filters: [{field: 'subscribed', operator: 'equals', value: true}]}],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Static segment member management
  const [pickedEmails, setPickedEmails] = useState<string[]>([]);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (segment) {
      setName(segment.name);
      setDescription(segment.description || '');
      setTrackMembership(segment.trackMembership);
      setCondition(
        (segment.condition as unknown as FilterCondition) || {
          logic: 'AND',
          groups: [{filters: [{field: 'subscribed', operator: 'equals', value: true}]}],
        },
      );
    }
  }, [segment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await network.fetch<Segment, typeof SegmentSchemas.update>('PATCH', `/segments/${id}`, {
        name,
        description: description || undefined,
        ...(segment?.type !== 'STATIC' && {condition}),
        trackMembership,
      });
      toast.success(t('segments.toast.updated'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.toast.updateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleComputeMembership = async () => {
    if (!trackMembership) {
      toast.error(t('segments.toast.trackingRequired'));
      return;
    }

    setIsComputing(true);
    try {
      const result = await network.fetch<{added: number; removed: number; total: number}>(
        'POST',
        `/segments/${id}/compute`,
      );
      toast.success(t('segments.toast.membershipUpdated', {added: result.added, removed: result.removed, total: result.total}));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.toast.computeFailed'));
    } finally {
      setIsComputing(false);
    }
  };

  const handleAddMembers = async (emails: string[], subscribed = true) => {
    setIsAddingMembers(true);
    try {
      const result = await network.fetch<{added: number; created: number; notFound: string[]}, typeof SegmentSchemas.members>(
        'POST',
        `/segments/${id}/members`,
        {emails, createMissing: true, subscribed},
      );

      const msg = result.created > 0
        ? t('segments.toast.addedContactsNew', {count: result.added, created: result.created})
        : t('segments.toast.addedContacts', {count: result.added});
      toast.success(msg);
      setPickedEmails([]);
      void mutate();
      void mutateContacts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.toast.addFailed'));
    } finally {
      setIsAddingMembers(false);
    }
  };

  const handleRemoveMember = async (email: string) => {
    setRemovingEmail(email);
    try {
      await network.fetch<{removed: number}, typeof SegmentSchemas.members>('DELETE', `/segments/${id}/members`, {
        emails: [email],
      });
      toast.success(t('segments.toast.removed', {email}));
      void mutate();
      void mutateContacts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.toast.removeFailed'));
    } finally {
      setRemovingEmail(null);
    }
  };

  const handleDelete = async () => {
    try {
      await network.fetch('DELETE', `/segments/${id}`);
      toast.success(t('segments.toast.deleted'));
      void router.push('/segments');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.toast.deleteFailed'));
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

  if (!segment) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-neutral-900 mb-2">{t('segments.detail.notFoundTitle')}</h3>
          <p className="text-neutral-500 mb-6">
            {t('segments.detail.notFoundDescription')}
          </p>
          <Button asChild>
            <Link href="/segments">
              <ArrowLeft className="h-4 w-4" />
              {t('segments.detail.backToSegments')}
            </Link>
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const isStatic = segment.type === 'STATIC';

  return (
    <DashboardLayout>
      <NextSeo title={segment.name} />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button asChild variant="outline" size="sm">
              <Link href="/segments"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{segment.name}</h1>
                <Badge variant={isStatic ? 'neutral' : 'default'}>
                  {isStatic ? t('segments.static') : t('segments.dynamic')}
                </Badge>
              </div>
              {segment.description && <p className="text-neutral-500 mt-1">{segment.description}</p>}
            </div>
          </div>
          <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="h-4 w-4" />
            {t('segments.deleteSegment')}
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Edit Form */}
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Basic Info */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('segments.detail.detailsTitle')}</CardTitle>
                  <CardDescription>{t('segments.detail.detailsDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="name">{t('segments.detail.nameLabel')}</Label>
                    <Input
                      id="name"
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                      placeholder={t('segments.detail.namePlaceholder')}
                      maxLength={100}
                    />
                  </div>

                  <div>
                    <Label htmlFor="description">{t('segments.detail.descriptionLabel')}</Label>
                    <Input
                      id="description"
                      type="text"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder={t('segments.detail.descriptionPlaceholder')}
                      maxLength={500}
                    />
                  </div>

                  <div className="flex items-start gap-3 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
                    <input
                      id="trackMembership"
                      type="checkbox"
                      checked={trackMembership}
                      onChange={e => setTrackMembership(e.target.checked)}
                      className="mt-1 h-4 w-4 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border-neutral-300 rounded"
                    />
                    <div className="flex-1">
                      <Label htmlFor="trackMembership" className="font-medium cursor-pointer">
                        {t('segments.detail.trackMembershipLabel')}
                      </Label>
                      <p className="text-xs text-neutral-500 mt-1">
                        {t('segments.detail.trackMembershipHelp')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Filter Builder (DYNAMIC only) */}
              {!isStatic && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('segments.detail.filterConditionsTitle')}</CardTitle>
                    <CardDescription>{t('segments.detail.filterConditionsDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SegmentFilterBuilder condition={condition} onChange={setCondition} currentSegmentId={id as string} />
                  </CardContent>
                </Card>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end">
                <Button type="submit" disabled={isSubmitting}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSubmitting ? t('common.saving') : t('segments.detail.saveChanges')}
                </Button>
              </div>
            </form>

            {/* Static member management */}
            {isStatic && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('segments.detail.addMembersTitle')}</CardTitle>
                  <CardDescription>{t('segments.detail.addMembersDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ContactPicker
                    selected={pickedEmails}
                    onChange={setPickedEmails}
                    onAdd={handleAddMembers}
                    existing={contactsData?.data.map(c => c.email) ?? []}
                    placeholder={t('segments.detail.addMembersPlaceholder')}
                  />
                  {pickedEmails.length > 0 && (
                    <Button
                      type="button"
                      onClick={() => void handleAddMembers(pickedEmails)}
                      disabled={isAddingMembers}
                      className="w-full"
                    >
                      {isAddingMembers ? t('segments.detail.addingMembers') : t('segments.detail.addContacts', {count: pickedEmails.length})}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Contacts */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{isStatic ? t('segments.detail.membersTitle') : t('segments.detail.matchingContactsTitle')}</CardTitle>
                    <CardDescription>
                      {isStatic ? t('segments.detail.membersDescription') : t('segments.detail.matchingContactsDescription')}
                    </CardDescription>
                  </div>
                  {!isStatic && trackMembership && (
                    <Button variant="outline" size="sm" onClick={handleComputeMembership} disabled={isComputing}>
                      <RefreshCw className={`h-4 w-4 ${isComputing ? 'animate-spin' : ''}`} />
                      {isComputing ? t('segments.detail.computing') : t('segments.detail.recompute')}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingContacts ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-neutral-500">{t('segments.detail.loadingContacts')}</p>
                  </div>
                ) : contactsData?.data.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title={isStatic ? t('segments.detail.noMembersTitle') : t('segments.detail.noMatchTitle')}
                    description={isStatic ? t('segments.detail.noMembersDescription') : t('segments.detail.noMatchDescription')}
                  />
                ) : (
                  <>
                    <div className="space-y-2">
                      {contactsData?.data.map(contact => (
                        <div key={contact.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-2">
                            {contact.subscribed ? (
                              <MailCheck className="h-4 w-4 text-green-600" />
                            ) : (
                              <MailX className="h-4 w-4 text-red-600" />
                            )}
                            <span className="text-sm font-medium">{contact.email}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`/contacts/${contact.id}`}>{t('common.view')}</Link>
                            </Button>
                            {isStatic && (
                              <Button
                                variant="destructiveGhost"
                                size="sm"
                                onClick={() => handleRemoveMember(contact.email)}
                                disabled={removingEmail === contact.email}
                              >
                                <UserMinus className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Pagination */}
                    {contactsData && contactsData.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t">
                        <p className="text-sm text-neutral-500">
                          {t('segments.detail.pageInfo', {page: contactsPage, totalPages: contactsData.totalPages, total: contactsData.total})}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setContactsPage(p => p - 1)}
                            disabled={contactsPage === 1}
                          >
                            {t('common.previous')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setContactsPage(p => p + 1)}
                            disabled={contactsPage === contactsData.totalPages}
                          >
                            {t('common.next')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Metadata Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('segments.detail.statisticsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-neutral-500" />
                    <span className="text-sm text-neutral-600">{t('segments.detail.membersStat')}</span>
                  </div>
                  <span className="text-2xl font-bold text-neutral-900">{segment.memberCount}</span>
                </div>

                {!isStatic && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-neutral-500" />
                        <span className="text-sm text-neutral-600">{t('segments.detail.filtersStat')}</span>
                      </div>
                      <span className="text-lg font-semibold text-neutral-900">
                        {countFilters(segment.condition as unknown as FilterCondition)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-neutral-500" />
                        <span className="text-sm text-neutral-600">{t('segments.detail.groupsStat')}</span>
                      </div>
                      <span className="text-lg font-semibold text-neutral-900">
                        {(segment.condition as unknown as FilterCondition)?.groups?.length || 0}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('segments.detail.metadataTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Database className="h-5 w-5 text-neutral-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{t('segments.detail.segmentId')}</p>
                    <p className="text-xs text-neutral-500 font-mono break-all">{segment.id}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-neutral-900">{t('segments.detail.createdLabel')}</p>
                  <div className="group relative inline-block cursor-help">
                    <p className="text-sm text-neutral-500">{dayjs(segment.createdAt).fromNow()}</p>
                    <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-0 mb-1 whitespace-nowrap">
                      {dayjs(segment.createdAt).format('DD MMMM YYYY, hh:mm')}
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-neutral-900">{t('segments.detail.lastUpdatedLabel')}</p>
                  <div className="group relative inline-block cursor-help">
                    <p className="text-sm text-neutral-500">{dayjs(segment.updatedAt).fromNow()}</p>
                    <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-0 mb-1 whitespace-nowrap">
                      {dayjs(segment.updatedAt).format('DD MMMM YYYY, hh:mm')}
                    </div>
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
        title={t('segments.deleteDialog.title')}
        description={t('segments.deleteDialog.description')}
        confirmText={t('common.delete')}
        variant="destructive"
      />
    </DashboardLayout>
  );
}
