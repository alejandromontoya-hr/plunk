import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconSpinner,
  Input,
  Label,
  Switch,
} from '@plunk/ui';
import type {Contact} from '@plunk/db';
import {ContactSchemas} from '@plunk/shared';
import type {CursorPaginatedResponse} from '@plunk/types';
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {DashboardLayout} from '../../components/DashboardLayout';
import {
  BulkActionBar,
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTableFilter,
  DataTableViewOptions,
  DataTableViewSwitcher,
  NoResultsState,
  isDataTableView,
  type DataTableColumnMeta,
  type DataTableView,
  type FacetedFilterOption,
} from '../../components/data-table';
import {KeyValueEditor} from '../../components/KeyValueEditor';
import {ImportContactsWizard} from '../../components/ImportContactsWizard';
import {AddToSegmentDialog} from '../../components/AddToSegmentDialog';
import {BulkSetFieldDialog} from '../../components/BulkSetFieldDialog';
import {network} from '../../lib/network';
import {useTranslation, type TranslateFn} from '../../lib/i18n';
import {formatRelativeTime} from '../../lib/dateUtils';
import {useColumnVisibility} from '../../lib/hooks/useColumnVisibility';
import {usePersistentState} from '../../lib/hooks/usePersistentState';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit,
  Layers,
  Loader2,
  Mail,
  MailCheck,
  MailX,
  Minus,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {NextSeo} from 'next-seo';
import Link from 'next/link';
import {useEffect, useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import dayjs from 'dayjs';

type StatusFilter = 'ALL' | 'subscribed' | 'unsubscribed';

const VIEW_STORAGE_KEY = 'plunk:contacts:view';
const COLUMNS_STORAGE_KEY = 'plunk:contacts:columns';

// select + email + actions are locked-visible (see lockedColumnIds). `updatedAt`
// starts hidden so the Columns menu has a meaningful toggle out of the box.
const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  select: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: false,
  actions: true,
};

export default function ContactsPage() {
  const {t} = useTranslation();
  // Fixed-value options for the Status faceted filter (table header) and the
  // card-view toolbar dropdown. Single source of truth for both.
  const STATUS_OPTIONS: FacetedFilterOption[] = useMemo(
    () => [
      {value: 'subscribed', label: t('contacts.status.subscribed')},
      {value: 'unsubscribed', label: t('contacts.status.unsubscribed')},
    ],
    [t],
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [currentPage, setCurrentPage] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [view, setView] = usePersistentState<DataTableView>(VIEW_STORAGE_KEY, 'table', isDataTableView);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useColumnVisibility(COLUMNS_STORAGE_KEY, DEFAULT_COLUMN_VISIBILITY);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [excludedContacts, setExcludedContacts] = useState<Set<string>>(new Set());
  const [showBulkActionsDialog, setShowBulkActionsDialog] = useState(false);
  const [bulkOperation, setBulkOperation] = useState<'subscribe' | 'unsubscribe' | 'delete' | null>(null);
  const [showAddToSegmentDialog, setShowAddToSegmentDialog] = useState(false);
  const [showSetFieldDialog, setShowSetFieldDialog] = useState(false);
  const pageSize = 50;

  // Backend is authoritative for sorting + status filtering
  // (?sort=&dir=, ?subscribed=); the client only mirrors the active state.
  const sortParam = sorting[0]?.id ?? '';
  const dirParam = sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : '';
  const subscribedParam = statusFilter === 'subscribed' ? 'true' : statusFilter === 'unsubscribed' ? 'false' : '';

  const {data, mutate, isLoading} = useSWR<CursorPaginatedResponse<Contact>>(
    `/contacts?limit=${pageSize}${cursor ? `&cursor=${cursor}` : ''}${
      search ? `&search=${encodeURIComponent(search)}` : ''
    }${subscribedParam ? `&subscribed=${subscribedParam}` : ''}${sortParam ? `&sort=${sortParam}&dir=${dirParam}` : ''}`,
    {revalidateOnFocus: false},
  );

  useEffect(() => {
    if (data) {
      setContacts(data.data);
      if (!cursor) {
        setTotalCount(data.total || data.data.length);
      }
    }
  }, [data, cursor]);

  // Reset the cursor stack — used whenever the query (search/status) or the
  // ordering changes, since cursors are tied to a specific filter + sort.
  const resetPagination = () => {
    setCursor(undefined);
    setCursorHistory([undefined]);
    setCurrentPage(0);
    setContacts([]);
  };

  const clearSelection = () => {
    setSelectedContacts(new Set());
    setSelectAllMatching(false);
    setExcludedContacts(new Set());
  };

  const handleStatusChange = (next: StatusFilter) => {
    setStatusFilter(next);
    resetPagination();
    clearSelection();
  };

  // Sorting only reorders the same matching set, so selection survives; but the
  // cursor stack is tied to the old ordering and must restart from the first page.
  const handleSortingChange: OnChangeFn<SortingState> = updater => {
    setSorting(prev => (typeof updater === 'function' ? updater(prev) : updater));
    resetPagination();
  };

  // Debounced search. Changing the query resets pagination and selection (the
  // matching set changed, so per-id selections no longer make sense).
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      setSearch(searchInput);
      resetPagination();
      clearSelection();
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  const handleNextPage = () => {
    if (data?.cursor) {
      const newPage = currentPage + 1;
      setCursor(data.cursor);
      setCurrentPage(newPage);
      // Preserve selection across pages only when "select all matching" is on; otherwise
      // clear, since per-page id sets stop being meaningful once you've left the page.
      if (!selectAllMatching) {
        setSelectedContacts(new Set());
      }

      if (cursorHistory.length <= newPage) {
        setCursorHistory(prev => [...prev, data.cursor]);
      }
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 0) {
      const newPage = currentPage - 1;
      const previousCursor = cursorHistory[newPage];
      setCursor(previousCursor);
      setCurrentPage(newPage);
      if (!selectAllMatching) {
        setSelectedContacts(new Set());
      }
    }
  };

  // True when the current page's checkbox should appear "all selected"
  const allOnPageSelected = contacts.length > 0 && (
    selectAllMatching
      ? contacts.every(c => !excludedContacts.has(c.id))
      : selectedContacts.size === contacts.length && contacts.every(c => selectedContacts.has(c.id))
  );

  const handleSelectAll = () => {
    if (selectAllMatching) {
      // Toggle: exclude or re-include all on this page
      if (allOnPageSelected) {
        setExcludedContacts(prev => {
          const next = new Set(prev);
          contacts.forEach(c => next.add(c.id));
          return next;
        });
      } else {
        setExcludedContacts(prev => {
          const next = new Set(prev);
          contacts.forEach(c => next.delete(c.id));
          return next;
        });
      }
      return;
    }
    if (allOnPageSelected) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(contacts.map(c => c.id)));
    }
  };

  const handleSelectContact = (contactId: string) => {
    if (selectAllMatching) {
      setExcludedContacts(prev => {
        const next = new Set(prev);
        if (next.has(contactId)) next.delete(contactId);
        else next.add(contactId);
        return next;
      });
      return;
    }
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  // Function declaration (hoisted) so the column defs and derived values above
  // can reference it regardless of source order.
  function isContactSelected(contactId: string) {
    return selectAllMatching ? !excludedContacts.has(contactId) : selectedContacts.has(contactId);
  }

  const effectiveSelectionCount = selectAllMatching
    ? Math.max(0, totalCount - excludedContacts.size)
    : selectedContacts.size;

  const handleBulkAction = (operation: 'subscribe' | 'unsubscribe' | 'delete') => {
    setBulkOperation(operation);
    setShowBulkActionsDialog(true);
  };

  const handleSelectAllMatching = () => {
    setSelectAllMatching(true);
    setSelectedContacts(new Set());
    setExcludedContacts(new Set());
  };

  // Toggle a single contact's subscription straight from the Status badge, so the
  // user can remove (or restore) the subscribed state inline without opening the
  // contact or using the bulk bar.
  const handleToggleSubscribed = async (contact: Contact) => {
    try {
      await network.fetch('PATCH', `/contacts/${contact.id}`, {subscribed: !contact.subscribed} as never);
      toast.success(t('contacts.toast.updated'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contacts.toast.updateFailed'));
    }
  };

  const promptDelete = (contactId: string) => {
    setContactToDelete(contactId);
    setShowDeleteDialog(true);
  };

  const handleDelete = async () => {
    if (!contactToDelete) return;

    try {
      await network.fetch('DELETE', `/contacts/${contactToDelete}`);
      toast.success(t('contacts.toast.deleted'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contacts.toast.deleteFailed'));
    } finally {
      setContactToDelete(null);
    }
  };

  const hasData = contacts.length > 0;

  // Whether any search/status filter is narrowing the list — drives the
  // "no results vs first-run empty" distinction below.
  const hasActiveFilters = search !== '' || statusFilter !== 'ALL';

  // Reset everything that can hide rows (search + status + pagination) so the
  // user can recover from a filter combination that matched nothing.
  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatusFilter('ALL');
    resetPagination();
    clearSelection();
  };

  const columns = useMemo<Array<ColumnDef<Contact, unknown>>>(
    () => [
      {
        id: 'select',
        enableSorting: false,
        enableHiding: false, // Selection column is locked-visible.
        meta: {label: t('contacts.columns.select'), headClassName: 'w-10', cellClassName: 'w-10'} satisfies DataTableColumnMeta,
        header: () => (
          <Checkbox
            aria-label={t('contacts.selectAllOnPage')}
            checked={allOnPageSelected ? true : contacts.some(c => isContactSelected(c.id)) ? 'indeterminate' : false}
            onCheckedChange={handleSelectAll}
          />
        ),
        cell: ({row}) => (
          <Checkbox
            aria-label={t('contacts.selectContact', {email: row.original.email})}
            checked={isContactSelected(row.original.id)}
            onClick={e => e.stopPropagation()}
            onCheckedChange={() => handleSelectContact(row.original.id)}
          />
        ),
      },
      {
        id: 'email',
        accessorKey: 'email',
        enableHiding: false, // Email column is locked-visible.
        meta: {label: t('contacts.columns.email')} satisfies DataTableColumnMeta,
        header: ({column}) => <DataTableColumnHeader column={column}>{t('contacts.columns.email')}</DataTableColumnHeader>,
        cell: ({row}) => (
          <div className="flex items-center gap-2">
            {row.original.subscribed ? (
              <MailCheck className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
            ) : (
              <MailX className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            )}
            <Link
              href={`/contacts/${row.original.id}`}
              className="text-sm font-medium text-neutral-900 hover:text-neutral-700 focus-visible:outline-none focus-visible:underline"
            >
              {row.original.email}
            </Link>
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'subscribed',
        enableSorting: false, // Status is faceted-filtered, not sorted.
        meta: {label: t('contacts.columns.status')} satisfies DataTableColumnMeta,
        header: ({column}) => (
          <DataTableColumnHeader
            column={column}
            filter={
              <DataTableFacetedFilter
                title={t('contacts.statusFilterTitle')}
                multiple={false}
                options={STATUS_OPTIONS}
                selected={statusFilter === 'ALL' ? [] : [statusFilter]}
                onChange={next => handleStatusChange((next[0] as StatusFilter) ?? 'ALL')}
              />
            }
          >
            {t('contacts.columns.status')}
          </DataTableColumnHeader>
        ),
        cell: ({row}) => (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              void handleToggleSubscribed(row.original);
            }}
            title={t('contacts.status.toggleHint')}
            className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          >
            <Badge variant={row.original.subscribed ? 'success' : 'destructive'} className="cursor-pointer">
              {row.original.subscribed ? t('contacts.status.subscribed') : t('contacts.status.unsubscribed')}
            </Badge>
          </button>
        ),
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        sortDescFirst: true, // First click surfaces the newest contacts.
        meta: {label: t('contacts.columns.created')} satisfies DataTableColumnMeta,
        header: ({column}) => <DataTableColumnHeader column={column}>{t('contacts.columns.created')}</DataTableColumnHeader>,
        cell: ({row}) => (
          <div className="group relative inline-block cursor-help text-sm text-neutral-500 whitespace-nowrap">
            {formatRelativeTime(row.original.createdAt)}
            <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-1/2 transform -translate-x-1/2 mb-1 whitespace-nowrap">
              {dayjs(row.original.createdAt).format('DD MMMM YYYY, hh:mm')}
            </div>
          </div>
        ),
      },
      {
        id: 'updatedAt',
        accessorKey: 'updatedAt',
        enableSorting: false, // No backend sort field for updatedAt.
        meta: {label: t('contacts.columns.updated')} satisfies DataTableColumnMeta,
        header: ({column}) => <DataTableColumnHeader column={column}>{t('contacts.columns.updated')}</DataTableColumnHeader>,
        cell: ({row}) => (
          <span className="text-sm text-neutral-500 whitespace-nowrap">
            {formatRelativeTime(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        enableSorting: false,
        enableHiding: false, // Actions column is locked-visible.
        meta: {label: t('contacts.columns.actions'), headClassName: 'text-right', cellClassName: 'text-right'} satisfies DataTableColumnMeta,
        header: () => <span className="flex justify-end">{t('contacts.columns.actions')}</span>,
        cell: ({row}) => (
          <div className="flex items-center justify-end gap-1">
            <Button asChild variant="ghost" size="sm" title={t('contacts.editContact')}>
              <Link href={`/contacts/${row.original.id}`} aria-label={t('contacts.editContact')}>
                <Edit className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title={t('contacts.deleteContact')}
              aria-label={t('contacts.deleteContact')}
              onClick={() => promptDelete(row.original.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    // Re-create columns when the facet selection or selection model changes so
    // the select-column checkboxes and the Status facet read fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusFilter, selectAllMatching, selectedContacts, excludedContacts, contacts, allOnPageSelected],
  );

  const table = useReactTable<Contact>({
    data: contacts,
    columns,
    state: {sorting, columnVisibility},
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: false, // Contacts owns a custom select-all-matching model.
    enableMultiSort: false,
    manualSorting: true, // Backend handles sorting; client just exposes ?sort=&dir=.
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => row.id,
  });

  return (
    <>
      <NextSeo title={t('contacts.title')} />
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('contacts.title')}</h1>
              <p className="text-neutral-500 mt-2 text-sm sm:text-base">
                {t('contacts.subtitle')}{' '}
                {totalCount > 0
                  ? hasActiveFilters
                    ? t('contacts.countMatching', {count: totalCount.toLocaleString()})
                    : t('contacts.countTotal', {count: totalCount.toLocaleString()})
                  : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowImportDialog(true)} className="flex-1 sm:flex-none">
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">{t('contacts.importCsv')}</span>
                <span className="sm:hidden">{t('contacts.importShort')}</span>
              </Button>
              <Button onClick={() => setShowCreateDialog(true)} className="flex-1 sm:flex-none">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t('contacts.addContact')}</span>
                <span className="sm:hidden">{t('common.add')}</span>
              </Button>
            </div>
          </div>

          {/* Control row. One aligned cluster of 32px-tall controls:
              - Search input: always present (both views).
              - Status filter: CARD VIEW ONLY, as a toolbar dropdown matching the
                Columns selector. In table view the Status filter lives in the
                column header facet instead (same shared menu body).
              - Columns selector: TABLE VIEW ONLY.
              - A hairline divider separates the data controls from the view switcher. */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <Input
                type="text"
                placeholder={t('contacts.searchPlaceholder')}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="pl-10 pr-10 h-8 text-xs"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label={t('contacts.clearSearch')}
                  onClick={() => {
                    setSearchInput('');
                    setSearch('');
                    resetPagination();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {view === 'card' && (
                <DataTableFilter
                  title={t('contacts.statusFilterTitle')}
                  multiple={false}
                  options={STATUS_OPTIONS}
                  selected={statusFilter === 'ALL' ? [] : [statusFilter]}
                  onChange={next => handleStatusChange((next[0] as StatusFilter) ?? 'ALL')}
                />
              )}
              {view === 'table' && (
                <DataTableViewOptions table={table} lockedColumnIds={['select', 'email', 'actions']} />
              )}
              <span className="hidden sm:block h-5 w-px bg-neutral-200" aria-hidden="true" />
              <DataTableViewSwitcher view={view} onChange={setView} />
            </div>
          </div>

          {/* Bulk action bar — appears in both views once a selection exists.
              Reuses the shared bar; the "select all matching" affordance rides in
              the `note` slot, the three async bulk operations are the children. */}
          {effectiveSelectionCount > 0 && (
            <BulkActionBar
              selectedCount={effectiveSelectionCount}
              itemNoun={t('contacts.itemNoun')}
              selectionLabel={t('contacts.selectedCount', {count: effectiveSelectionCount.toLocaleString()})}
              onClear={clearSelection}
              note={
                !selectAllMatching && allOnPageSelected && totalCount > contacts.length ? (
                  <button
                    type="button"
                    onClick={handleSelectAllMatching}
                    className="text-sm font-medium text-neutral-600 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline focus-visible:outline-none focus-visible:underline focus-visible:text-neutral-900 whitespace-nowrap rounded-sm tabular-nums"
                  >
                    {hasActiveFilters
                      ? t('contacts.selectAllMatchingFiltered', {count: totalCount.toLocaleString()})
                      : t('contacts.selectAllMatching', {count: totalCount.toLocaleString()})}
                  </button>
                ) : selectAllMatching ? (
                  <span className="text-sm text-neutral-500 whitespace-nowrap">{t('contacts.allMatchingSelected')}</span>
                ) : null
              }
            >
              <Button variant="outline" size="sm" onClick={() => setShowAddToSegmentDialog(true)}>
                <Layers className="h-4 w-4" />
                {t('contacts.addToSegment.title')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowSetFieldDialog(true)}>
                <Tag className="h-4 w-4" />
                {t('contacts.setField.title')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('delete')}
                className="text-neutral-700 transition-colors hover:bg-red-50 hover:text-red-700 hover:border-red-200"
              >
                <Trash2 className="h-4 w-4" />
                {t('contacts.bulk.delete')}
              </Button>
            </BulkActionBar>
          )}

          {/* Contacts */}
          <div>
            {isLoading && contacts.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-center py-12">
                    <IconSpinner />
                  </div>
                </CardContent>
              </Card>
            ) : !hasData ? (
              <Card>
                <CardContent>
                  {hasActiveFilters ? (
                    // Items exist, but the active search/status filters matched
                    // none — offer a one-click recovery.
                    <NoResultsState icon={Mail} itemNoun={t('contacts.noResultsNoun')} onClear={clearFilters} />
                  ) : (
                    // Genuinely empty project — first-run state.
                    <EmptyState
                      icon={Mail}
                      title={t('contacts.empty.title')}
                      description={t('contacts.empty.description')}
                      action={
                        <Button onClick={() => setShowCreateDialog(true)}>
                          <Plus className="h-4 w-4" />
                          {t('contacts.addContact')}
                        </Button>
                      }
                    />
                  )}
                </CardContent>
              </Card>
            ) : view === 'card' ? (
              <>
                {/* Card grid view */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {contacts.map(contact => {
                    const selected = isContactSelected(contact.id);
                    return (
                      <Card
                        key={contact.id}
                        data-state={selected ? 'selected' : undefined}
                        className="flex flex-col transition-colors hover:border-neutral-300 data-[state=selected]:border-neutral-400 data-[state=selected]:bg-neutral-50/60"
                      >
                        <div className="flex items-start gap-3 p-4">
                          <Checkbox
                            className="mt-0.5 shrink-0"
                            checked={selected}
                            onCheckedChange={() => handleSelectContact(contact.id)}
                            aria-label={`Select ${contact.email}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <Link
                                href={`/contacts/${contact.id}`}
                                className="flex min-w-0 items-center gap-2 text-sm font-medium text-neutral-900 hover:text-neutral-700 focus-visible:outline-none focus-visible:underline"
                              >
                                {contact.subscribed ? (
                                  <MailCheck className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                                ) : (
                                  <MailX className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                                )}
                                <span className="truncate">{contact.email}</span>
                              </Link>
                              <button
                                type="button"
                                onClick={() => void handleToggleSubscribed(contact)}
                                title={t('contacts.status.toggleHint')}
                                className="shrink-0 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                              >
                                <Badge variant={contact.subscribed ? 'success' : 'destructive'} className="cursor-pointer">
                                  {contact.subscribed ? t('contacts.status.subscribed') : t('contacts.status.unsubscribed')}
                                </Badge>
                              </button>
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                              <div className="group relative inline-block cursor-help">
                                <span className="text-xs text-neutral-400">
                                  {t('contacts.addedRelative', {time: formatRelativeTime(contact.createdAt)})}
                                </span>
                                <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-0 mb-1 whitespace-nowrap">
                                  {dayjs(contact.createdAt).format('DD MMMM YYYY, hh:mm')}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button asChild variant="ghost" size="sm" title={t('contacts.editContact')}>
                                  <Link href={`/contacts/${contact.id}`} aria-label={t('contacts.editContact')}>
                                    <Edit className="h-4 w-4" />
                                  </Link>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={t('contacts.deleteContact')}
                                  aria-label={t('contacts.deleteContact')}
                                  onClick={() => promptDelete(contact.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>

                {(currentPage > 0 || data?.hasMore) && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-6">
                    <p className="text-sm text-neutral-500 tabular-nums">
                      {totalCount > 0
                        ? t('contacts.pagination.showingOf', {
                            from: (currentPage * pageSize + 1).toLocaleString(),
                            to: (currentPage * pageSize + contacts.length).toLocaleString(),
                            total: totalCount.toLocaleString(),
                          })
                        : t('contacts.pagination.showing', {
                            from: (currentPage * pageSize + 1).toLocaleString(),
                            to: (currentPage * pageSize + contacts.length).toLocaleString(),
                          })}
                    </p>
                    <div className="flex items-center gap-2 justify-center sm:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePreviousPage}
                        disabled={currentPage === 0 || isLoading}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('common.previous')}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleNextPage}
                        disabled={!data?.hasMore || isLoading}
                      >
                        <span className="hidden sm:inline">{t('common.next')}</span>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Table view (tanstack-driven) */}
                <Card>
                  <CardContent className="p-0">
                    <DataTable table={table} getRowSelected={c => isContactSelected(c.id)} />
                  </CardContent>
                </Card>

                {(currentPage > 0 || data?.hasMore) && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-6">
                    <p className="text-sm text-neutral-500 tabular-nums">
                      {totalCount > 0
                        ? t('contacts.pagination.showingOf', {
                            from: (currentPage * pageSize + 1).toLocaleString(),
                            to: (currentPage * pageSize + contacts.length).toLocaleString(),
                            total: totalCount.toLocaleString(),
                          })
                        : t('contacts.pagination.showing', {
                            from: (currentPage * pageSize + 1).toLocaleString(),
                            to: (currentPage * pageSize + contacts.length).toLocaleString(),
                          })}
                    </p>
                    <div className="flex items-center gap-2 justify-center sm:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePreviousPage}
                        disabled={currentPage === 0 || isLoading}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('common.previous')}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleNextPage}
                        disabled={!data?.hasMore || isLoading}
                      >
                        <span className="hidden sm:inline">{t('common.next')}</span>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Create Contact Dialog */}
        <CreateContactDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onSuccess={() => mutate()} />

        {/* Import Contacts Dialog */}
        <ImportContactsWizard open={showImportDialog} onOpenChange={setShowImportDialog} onSuccess={() => mutate()} />

        {/* Bulk Actions Dialog */}
        <BulkActionsDialog
          open={showBulkActionsDialog}
          onOpenChange={setShowBulkActionsDialog}
          operation={bulkOperation}
          selector={
            selectAllMatching
              ? {
                  mode: 'query',
                  // Mirror the active list filters so "select all matching"
                  // targets exactly the rows the user is looking at.
                  filter: {
                    ...(search ? {search} : {}),
                    ...(statusFilter !== 'ALL' ? {subscribed: statusFilter === 'subscribed'} : {}),
                  },
                  excludeIds: Array.from(excludedContacts),
                }
              : {mode: 'ids', contactIds: Array.from(selectedContacts)}
          }
          targetCount={effectiveSelectionCount}
          onSuccess={() => {
            mutate();
            clearSelection();
          }}
        />

        {/* Add to Segment Dialog */}
        <AddToSegmentDialog
          open={showAddToSegmentDialog}
          onOpenChange={setShowAddToSegmentDialog}
          selector={
            selectAllMatching
              ? {
                  mode: 'query',
                  filter: {
                    ...(search ? {search} : {}),
                    ...(statusFilter !== 'ALL' ? {subscribed: statusFilter === 'subscribed'} : {}),
                  },
                  excludeIds: Array.from(excludedContacts),
                }
              : {mode: 'ids', contactIds: Array.from(selectedContacts)}
          }
          targetCount={effectiveSelectionCount}
          onSuccess={() => {
            mutate();
            clearSelection();
          }}
        />

        {/* Assign custom field in bulk */}
        <BulkSetFieldDialog
          open={showSetFieldDialog}
          onOpenChange={setShowSetFieldDialog}
          selector={
            selectAllMatching
              ? {
                  mode: 'query',
                  filter: {
                    ...(search ? {search} : {}),
                    ...(statusFilter !== 'ALL' ? {subscribed: statusFilter === 'subscribed'} : {}),
                  },
                  excludeIds: Array.from(excludedContacts),
                }
              : {mode: 'ids', contactIds: Array.from(selectedContacts)}
          }
          targetCount={effectiveSelectionCount}
          onSuccess={() => {
            mutate();
            clearSelection();
          }}
        />

        {/* Delete Confirmation Dialog */}
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

interface CreateContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function CreateContactDialog({open, onOpenChange, onSuccess}: CreateContactDialogProps) {
  const {t} = useTranslation();
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(true);
  const [customData, setCustomData] = useState<Record<string, string | number | boolean> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await network.fetch<
        {
          _meta?: {isNew: boolean; isUpdate: boolean};
          email: string;
        },
        typeof ContactSchemas.create
      >('POST', '/contacts', {email, subscribed, data: customData});

      // Show appropriate message based on whether contact was new or updated
      if (response._meta?.isUpdate) {
        toast.success(t('contacts.toast.createdUpdated', {email: response.email}));
      } else {
        toast.success(t('contacts.toast.created'));
      }

      setEmail('');
      setSubscribed(true);
      setCustomData(null);
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contacts.toast.saveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('contacts.createDialog.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('contacts.createDialog.emailLabel')}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder={t('contacts.createDialog.emailPlaceholder')}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="subscribed" className="font-medium cursor-pointer">
                {t('contacts.createDialog.subscribedLabel')}
              </Label>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t('contacts.createDialog.subscribedHelp')}
              </p>
            </div>
            <Switch id="subscribed" checked={subscribed} onCheckedChange={setSubscribed} />
          </div>

          <KeyValueEditor key={open ? 'create' : 'closed'} initialData={customData} onChange={setCustomData} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('contacts.createDialog.submitting') : t('contacts.createDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type BulkSelector =
  | {mode: 'ids'; contactIds: string[]}
  | {mode: 'query'; filter: {search?: string; subscribed?: boolean}; excludeIds: string[]};

interface BulkActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: 'subscribe' | 'unsubscribe' | 'delete' | null;
  selector: BulkSelector;
  targetCount: number;
  onSuccess: () => void;
}

interface BulkActionResult {
  operation: 'subscribe' | 'unsubscribe' | 'delete';
  totalRequested: number;
  /** Contacts whose state was actually changed by this run. */
  successCount: number;
  /** Subscribe/unsubscribe only: contacts that were already in the target state. */
  unchangedCount: number;
  /** Contacts that errored or weren't found. */
  failureCount: number;
  errors: Array<{contactId: string; email: string; error: string}>;
}

function BulkActionsDialog({open, onOpenChange, operation, selector, targetCount, onSuccess}: BulkActionsDialogProps) {
  const {t} = useTranslation();
  const [, setJobId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  const [result, setResult] = useState<BulkActionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);

  // Clean up polling on unmount or dialog close
  useEffect(() => {
    if (!open) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setTimeout(() => {
        setJobId(null);
        setProgress(0);
        setStatus('idle');
        setResult(null);
        setErrorMessage(null);
      }, 300);
    }
  }, [open]);

  const pollJobStatus = async (jobId: string) => {
    try {
      const response = await network.fetch<{
        id: string;
        state: string;
        progress: number;
        result: BulkActionResult | null;
        failedReason?: string;
      }>('GET', `/contacts/bulk/${jobId}`);

      setProgress(response.progress || 0);

      if (response.state === 'completed') {
        setStatus('completed');
        setResult(response.result);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        if (response.result) {
          toast.success(buildToastSummary(response.result, t));
        }

        onSuccess();
      } else if (response.state === 'failed') {
        setStatus('failed');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        const errorMsg = response.failedReason || 'Operation failed';
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
      } else if (response.state === 'active') {
        setStatus('processing');
      }
    } catch (error) {
      console.error('Failed to poll job status:', error);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setStatus('failed');
      toast.error('Failed to check operation status');
    }
  };

  const handleConfirm = async () => {
    if (!operation) return;

    setIsProcessing(true);
    setStatus('processing');

    try {
      const endpoint = `/contacts/bulk-${operation}`;
      const data = await network.fetch<{jobId: string; message: string}, typeof ContactSchemas.bulkAction>(
        'POST',
        endpoint,
        selector,
      );

      setJobId(data.jobId);

      // Start polling for job status
      pollIntervalRef.current = setInterval(() => {
        void pollJobStatus(data.jobId);
      }, 1000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to start operation';
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
      setStatus('failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (status === 'processing') {
      setShowCloseConfirmDialog(true);
      return;
    }
    onOpenChange(false);
  };

  const confirmClose = () => {
    onOpenChange(false);
  };

  const copy = getOperationCopy(operation, t);

  const isQueueing = status === 'processing' && progress === 0;
  const dialogTitle =
    status === 'completed'
      ? copy.completedTitle
      : status === 'processing'
      ? copy.progressTitle
      : status === 'failed'
      ? copy.failedTitle
      : copy.title;

  const handleRetry = () => {
    setErrorMessage(null);
    setStatus('idle');
    void handleConfirm();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="transition-colors">{dialogTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {status === 'idle' && (
              <div className="space-y-3 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
                <p className="text-sm text-neutral-700 leading-relaxed">
                  {copy.confirmVerb}{' '}
                  <span className="font-medium text-neutral-900 tabular-nums">
                    {targetCount.toLocaleString()} {targetCount === 1 ? t('contacts.itemNoun') : t('contacts.noResultsNoun')}
                  </span>
                  ?
                  {copy.skipNote && <span className="text-neutral-500"> {copy.skipNote}</span>}
                </p>
                {operation === 'delete' && (
                  <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
                    <p className="leading-relaxed">
                      <span className="font-medium">{t('contacts.bulkDialog.deleteWarningStrong')}</span>{' '}
                      {t('contacts.bulkDialog.deleteWarning')}
                    </p>
                  </div>
                )}
                {selector.mode === 'query' && (
                  <p className="text-xs text-neutral-500 leading-relaxed">{t('contacts.bulkDialog.queryNote')}</p>
                )}
              </div>
            )}

            {status === 'processing' && (
              <div className="space-y-3 py-1 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="flex items-center gap-2 text-neutral-600">
                    {isQueueing && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                    <span>
                      {isQueueing
                        ? t('contacts.bulkDialog.queued')
                        : `${copy.processingLabel} ${targetCount.toLocaleString()} ${
                            targetCount === 1 ? t('contacts.itemNoun') : t('contacts.noResultsNoun')
                          }`}
                    </span>
                  </span>
                  <span
                    className={`tabular-nums font-medium transition-opacity ${
                      isQueueing ? 'text-neutral-400' : 'text-neutral-900'
                    }`}
                  >
                    {progress}%
                  </span>
                </div>
                <div className="relative w-full bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                  {isQueueing ? (
                    <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-neutral-300 motion-safe:animate-[indeterminate_1.4s_ease-in-out_infinite]" />
                  ) : (
                    <div
                      className="bg-neutral-900 h-full rounded-full transition-[width] duration-500 ease-out"
                      style={{width: `${progress}%`}}
                    />
                  )}
                </div>
              </div>
            )}

            {status === 'completed' && result && <BulkResultSummary result={result} />}

            {status === 'failed' && (
              <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} />
                <p className="leading-relaxed">{errorMessage || t('contacts.bulkDialog.failedGeneric')}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            {status === 'idle' ? (
              <>
                <Button type="button" variant="outline" onClick={handleClose}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isProcessing}
                  variant={operation === 'delete' ? 'destructive' : 'default'}
                >
                  {isProcessing ? t('contacts.bulkDialog.starting') : copy.confirmButton}
                </Button>
              </>
            ) : status === 'failed' ? (
              <>
                <Button type="button" variant="outline" onClick={handleClose}>
                  {t('common.close')}
                </Button>
                <Button type="button" onClick={handleRetry} variant={operation === 'delete' ? 'destructive' : 'default'}>
                  {t('common.tryAgain')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={handleClose}
                variant={status === 'completed' ? 'default' : 'outline'}
              >
                {status === 'completed' ? t('contacts.bulkDialog.done') : t('contacts.bulkDialog.hide')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showCloseConfirmDialog}
        onOpenChange={setShowCloseConfirmDialog}
        onConfirm={confirmClose}
        title={t('contacts.bulkDialog.closeConfirm.title')}
        description={t('contacts.bulkDialog.closeConfirm.description')}
        confirmText={t('contacts.bulkDialog.closeConfirm.confirmText')}
        variant="default"
      />
    </>
  );
}

interface OperationCopy {
  title: string;
  progressTitle: string;
  completedTitle: string;
  failedTitle: string;
  confirmVerb: string;
  confirmButton: string;
  processingLabel: string;
  /** Past-tense verb used in result rows: "12 subscribed". */
  changedVerb: string;
  /** Result-state noun phrase: "contacts subscribed" — pluralisation handled separately. */
  summaryNoun: string;
  /** Past participle for "already X": "already subscribed". null = no skip case. */
  alreadyState: string | null;
  /** Note shown next to the confirm prompt for ops with skip semantics. */
  skipNote: string | null;
}

function getOperationCopy(operation: 'subscribe' | 'unsubscribe' | 'delete' | null, t: TranslateFn): OperationCopy {
  if (operation === 'subscribe' || operation === 'unsubscribe' || operation === 'delete') {
    const base = `contacts.operations.${operation}`;
    // subscribe/unsubscribe can leave contacts unchanged (already in the target
    // state); delete cannot, so it has no "already"/"skip" copy.
    const hasAlready = operation !== 'delete';
    return {
      title: t(`${base}.title`),
      progressTitle: t(`${base}.progressTitle`),
      completedTitle: t(`${base}.completedTitle`),
      failedTitle: t(`${base}.failedTitle`),
      confirmVerb: t(`${base}.confirmVerb`),
      confirmButton: t(`${base}.confirmButton`),
      processingLabel: t(`${base}.processingLabel`),
      changedVerb: t(`${base}.changedVerb`),
      summaryNoun: t(`${base}.summaryNoun`),
      alreadyState: hasAlready ? t(`${base}.alreadyState`) : null,
      skipNote: hasAlready ? t(`${base}.skipNote`) : null,
    };
  }
  return {
    title: t('common.loading'),
    progressTitle: t('common.loading'),
    completedTitle: t('common.success'),
    failedTitle: t('common.error'),
    confirmVerb: t('common.confirm'),
    confirmButton: t('common.confirm'),
    processingLabel: t('common.loading'),
    changedVerb: '',
    summaryNoun: '',
    alreadyState: null,
    skipNote: null,
  };
}

function buildToastSummary(result: BulkActionResult, t: TranslateFn): string {
  const copy = getOperationCopy(result.operation, t);
  const parts: string[] = [];
  if (result.successCount > 0) parts.push(`${result.successCount.toLocaleString()} ${copy.changedVerb}`);
  if (result.unchangedCount > 0 && copy.alreadyState) {
    parts.push(`${result.unchangedCount.toLocaleString()} ${copy.alreadyState}`);
  }
  if (result.failureCount > 0) {
    parts.push(`${result.failureCount.toLocaleString()} ${t('contacts.bulkDialog.failedCount')}`);
  }
  if (parts.length === 0) return t('contacts.bulkDialog.noContactsToUpdate');
  return parts.join(' · ');
}

function BulkResultSummary({result}: {result: BulkActionResult}) {
  const {t} = useTranslation();
  const copy = getOperationCopy(result.operation, t);
  const {successCount, unchangedCount, failureCount} = result;
  const noChanges = successCount === 0 && failureCount === 0 && unchangedCount > 0;
  const total = successCount + unchangedCount + failureCount;

  // Build the row list. The "primary" row is the row that represents what the
  // user actually got — usually the changed count, but when nothing changed we
  // promote the "already in state" row so the summary still has a clear lead.
  type Row = {
    key: string;
    label: string;
    count: number;
    primary?: boolean;
    tone?: 'default' | 'danger';
  };
  const rows: Row[] = [];

  if (noChanges && copy.alreadyState) {
    rows.push({key: 'already', label: copy.alreadyState, count: unchangedCount, primary: true});
  } else {
    rows.push({key: 'changed', label: copy.completedTitle, count: successCount, primary: true});
    if (unchangedCount > 0 && copy.alreadyState) {
      rows.push({key: 'already', label: copy.alreadyState, count: unchangedCount});
    }
  }
  if (failureCount > 0) {
    rows.push({key: 'failed', label: t('contacts.bulkDialog.failedRow'), count: failureCount, tone: 'danger'});
  }

  return (
    <div className="space-y-3 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300">
      <div className="rounded-lg border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
        {rows.map(row => {
          const isPrimary = !!row.primary;
          const isDanger = row.tone === 'danger';
          return (
            <div
              key={row.key}
              className={`flex items-center gap-3 px-4 ${isPrimary ? 'py-4' : 'py-2.5'}`}
            >
              {/* Status mark — only on the primary row. Subsequent rows leave the
                  same column blank to keep the labels in a single visual track. */}
              <div className="w-7 shrink-0 flex items-center">
                {isPrimary && (
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full ${
                      noChanges ? 'bg-neutral-100 text-neutral-500' : 'bg-neutral-900 text-white'
                    }`}
                  >
                    {noChanges ? (
                      <Minus className="h-3.5 w-3.5" />
                    ) : (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    )}
                  </div>
                )}
              </div>
              <div
                className={`flex-1 first-letter:capitalize ${
                  isPrimary
                    ? 'text-sm font-medium text-neutral-900'
                    : isDanger
                    ? 'text-sm text-red-600'
                    : 'text-sm text-neutral-500'
                }`}
              >
                {row.label}
              </div>
              <div
                className={`tabular-nums tracking-tight ${
                  isPrimary
                    ? 'text-2xl font-semibold text-neutral-900 leading-none'
                    : isDanger
                    ? 'text-sm font-medium text-red-700'
                    : 'text-sm font-medium text-neutral-700'
                }`}
              >
                {row.count.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      {total > 1 && rows.length > 1 && (
        <div className="px-4 flex items-baseline justify-between text-xs text-neutral-500">
          <span>{t('contacts.bulkDialog.totalProcessed')}</span>
          <span className="tabular-nums font-medium text-neutral-700">{total.toLocaleString()}</span>
        </div>
      )}

      {result.errors && result.errors.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-700 select-none px-4">
            {t('contacts.bulkDialog.showErrorDetails', {count: result.errors.length.toLocaleString()})}
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-neutral-200 divide-y divide-neutral-100 text-xs">
            {result.errors.slice(0, 10).map((error, idx) => (
              <div key={idx} className="px-3 py-2 text-red-700">
                {error.error}
              </div>
            ))}
            {result.errors.length > 10 && (
              <div className="px-3 py-2 text-neutral-500">
                {t('contacts.bulkDialog.moreErrors', {count: (result.errors.length - 10).toLocaleString()})}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

