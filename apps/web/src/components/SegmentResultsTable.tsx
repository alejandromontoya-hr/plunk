import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconSpinner,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@plunk/ui';
import type {Campaign} from '@plunk/db';
import type {ContactWithActivity, PaginatedResponse} from '@plunk/types';
import {CalendarClock, RotateCcw, Send, Users} from 'lucide-react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import dayjs from 'dayjs';

import {network} from '../lib/network';
import {useTranslation} from '../lib/i18n';

interface AvailableField {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  coverage: number;
}

interface FieldsResponse {
  fields: AvailableField[];
  count: number;
}

interface FieldValuesResponse {
  field: string;
  values: Array<string | number | boolean>;
  count: number;
}

interface SnapshotResponse {
  segmentId: string;
  snapshot: boolean;
  total: number;
}

const PAGE_SIZE = 20;

/** Pull a JSON custom field off a contact's `data` blob. */
function readField(contact: ContactWithActivity, field: string): string {
  if (!field) return '';
  const key = field.startsWith('data.') ? field.slice(5) : field;
  const data = contact.data as Record<string, unknown> | null;
  const value = data?.[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Best-guess default column for a role, by matching the custom field key. */
function guessField(fields: AvailableField[], patterns: RegExp, fallbackIndex: number): string {
  const custom = fields.filter(f => f.field.startsWith('data.'));
  const match = custom.find(f => patterns.test(f.field.slice(5)));
  if (match) return match.field;
  return custom[fallbackIndex]?.field ?? custom[0]?.field ?? '';
}

export function SegmentResultsTable({segmentId}: {segmentId: string}) {
  const {t} = useTranslation();
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [companyField, setCompanyField] = useState('');
  const [sectorField, setSectorField] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [configured, setConfigured] = useState(false);

  // Campaign target dialog
  const [dialog, setDialog] = useState<{open: boolean; intent: 'send' | 'schedule'; segmentId: string} | null>(null);
  const [draftCampaigns, setDraftCampaigns] = useState<Campaign[] | null>(null);
  const [selectedDraft, setSelectedDraft] = useState('');
  const [preparing, setPreparing] = useState(false);

  const {data: fieldsData} = useSWR<FieldsResponse>('/contacts/fields', {revalidateOnFocus: false});
  const customFields = useMemo(() => (fieldsData?.fields ?? []).filter(f => f.field.startsWith('data.')), [fieldsData]);

  // Auto-pick sensible default columns once fields load (user can override).
  useEffect(() => {
    if (configured || customFields.length === 0) return;
    setCompanyField(guessField(customFields, /empresa|company|organ|cuenta/i, 0));
    setSectorField(guessField(customFields, /sector|industr|rubro|vertical/i, 1));
    setConfigured(true);
  }, [customFields, configured]);

  const {data: sectorValuesData} = useSWR<FieldValuesResponse>(
    sectorField ? `/contacts/fields/${encodeURIComponent(sectorField)}/values` : null,
    {revalidateOnFocus: false},
  );
  const sectorValues = useMemo(
    () => (sectorValuesData?.values ?? []).map(String).filter(Boolean),
    [sectorValuesData],
  );

  const filterQs = sectorFilter && sectorField ? `&filterField=${encodeURIComponent(sectorField)}&filterValue=${encodeURIComponent(sectorFilter)}` : '';
  const {data: contactsData, isLoading, mutate: mutateContacts} = useSWR<PaginatedResponse<ContactWithActivity>>(
    `/segments/${segmentId}/contacts?page=${page}&pageSize=${PAGE_SIZE}${filterQs}`,
  );

  const rows = contactsData?.data ?? [];
  const total = contactsData?.total ?? 0;
  const totalPages = contactsData?.totalPages ?? 1;
  const selectedCount = Math.max(0, total - excluded.size);

  // Changing the sector filter changes the audience — start from "all selected".
  useEffect(() => {
    setExcluded(new Set());
    setPage(1);
  }, [sectorFilter]);

  const pageIds = rows.map(r => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => !excluded.has(id));

  const toggleRow = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach(id => next.add(id));
      else pageIds.forEach(id => next.delete(id));
      return next;
    });
  };

  const saveSector = async (contact: ContactWithActivity, value: string) => {
    if (!sectorField) return;
    const key = sectorField.slice(5);
    try {
      await network.fetch('PATCH', `/contacts/${contact.id}`, {data: {[key]: value || null}} as never);
      toast.success(t('segments.results.sectorSaved'));
      void mutateContacts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.results.sectorSaveFailed'));
    }
  };

  const openTargetDialog = async (intent: 'send' | 'schedule') => {
    if (selectedCount === 0) {
      toast.error(t('segments.results.noneSelected'));
      return;
    }
    setPreparing(true);
    try {
      const excludedContactIds = Array.from(excluded);
      const snap = await network.fetch<SnapshotResponse>('POST', `/segments/${segmentId}/snapshot`, {
        excludedContactIds,
        ...(sectorFilter && sectorField ? {filterField: sectorField, filterValue: sectorFilter} : {}),
      } as never);
      setDialog({open: true, intent, segmentId: snap.segmentId});
      setSelectedDraft('');
      if (draftCampaigns === null) {
        const list = await network.fetch<PaginatedResponse<Campaign>>('GET', '/campaigns?status=DRAFT&pageSize=100');
        setDraftCampaigns(list.data ?? []);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.results.snapshotFailed'));
    } finally {
      setPreparing(false);
    }
  };

  const goToNewCampaign = () => {
    if (!dialog) return;
    const params = new URLSearchParams({audienceType: 'SEGMENT', segmentId: dialog.segmentId});
    if (dialog.intent === 'schedule') params.set('intent', 'schedule');
    void router.push(`/campaigns/create?${params.toString()}`);
  };

  const attachToDraft = async () => {
    if (!dialog || !selectedDraft) return;
    try {
      await network.fetch('PATCH', `/campaigns/${selectedDraft}`, {
        audienceType: 'SEGMENT',
        segmentId: dialog.segmentId,
      } as never);
      const suffix = dialog.intent === 'schedule' ? '?intent=schedule' : '';
      void router.push(`/campaigns/${selectedDraft}${suffix}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('segments.results.attachFailed'));
    }
  };

  return (
    <div className="space-y-4">
      {/* Column configuration + sector filter */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <div className="space-y-1">
          <Label className="text-xs text-neutral-500">{t('segments.results.companyColumn')}</Label>
          <Select value={companyField} onValueChange={setCompanyField}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder={t('segments.results.noField')} /></SelectTrigger>
            <SelectContent>
              {customFields.map(f => <SelectItem key={f.field} value={f.field}>{f.field.slice(5)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-neutral-500">{t('segments.results.sectorColumn')}</Label>
          <Select value={sectorField} onValueChange={v => {setSectorField(v); setSectorFilter('');}}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder={t('segments.results.noField')} /></SelectTrigger>
            <SelectContent>
              {customFields.map(f => <SelectItem key={f.field} value={f.field}>{f.field.slice(5)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {sectorField && (
          <div className="space-y-1">
            <Label className="text-xs text-neutral-500">{t('segments.results.filterBySector')}</Label>
            <Select value={sectorFilter || '__all__'} onValueChange={v => setSectorFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('segments.results.allSectors')}</SelectItem>
                {sectorValues.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={t('segments.results.selectPage')}
                  checked={allPageSelected}
                  onChange={togglePage}
                  className="h-4 w-4 rounded border-neutral-300"
                />
              </th>
              <th className="px-3 py-2.5 font-medium">{t('segments.results.contact')}</th>
              <th className="px-3 py-2.5 font-medium">{t('segments.results.company')}</th>
              <th className="px-3 py-2.5 font-medium">{t('segments.results.sector')}</th>
              <th className="px-3 py-2.5 font-medium">{t('segments.results.lastSent')}</th>
              <th className="px-3 py-2.5 text-right font-medium">{t('segments.results.daysSince')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-neutral-500"><IconSpinner /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-neutral-500">{t('segments.results.noResults')}</td></tr>
            ) : (
              rows.map(contact => {
                const selected = !excluded.has(contact.id);
                const days = contact.lastSentAt ? dayjs().diff(dayjs(contact.lastSentAt), 'day') : null;
                const currentSector = readField(contact, sectorField);
                const sectorOptions = Array.from(new Set([...sectorValues, ...(currentSector ? [currentSector] : [])]));
                return (
                  <tr key={contact.id} className={`border-t border-neutral-100 ${selected ? '' : 'opacity-50'}`}>
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`${t('segments.results.select')} ${contact.email}`}
                        checked={selected}
                        onChange={() => toggleRow(contact.id)}
                        className="h-4 w-4 rounded border-neutral-300"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/contacts/${contact.id}`} className="font-medium text-neutral-900 hover:underline">
                        {contact.email}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-neutral-600">{readField(contact, companyField) || '—'}</td>
                    <td className="px-3 py-2.5">
                      {sectorField ? (
                        <select
                          value={currentSector}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === '__new__') {
                              const created = window.prompt(t('segments.results.newSectorPrompt'));
                              if (created && created.trim()) void saveSector(contact, created.trim());
                            } else {
                              void saveSector(contact, v);
                            }
                          }}
                          className="max-w-[150px] rounded border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-700 focus:border-neutral-400 focus:outline-none"
                        >
                          <option value="">{t('segments.results.noSector')}</option>
                          {sectorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                          <option value="__new__">{t('segments.results.newSectorOption')}</option>
                        </select>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-600">
                      {contact.lastSentAt ? dayjs(contact.lastSentAt).format('DD MMM YYYY') : t('segments.results.never')}
                    </td>
                    <td className={`px-3 py-2.5 text-right ${days != null && days > 60 ? 'text-amber-600' : 'text-neutral-600'}`}>
                      {days != null ? days : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: selection summary + pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Users className="h-4 w-4 text-neutral-400" />
          <span>
            <span className="font-medium text-neutral-900">{selectedCount.toLocaleString()}</span>
            {' '}{t('segments.results.ofSelected', {total: total.toLocaleString()})}
          </span>
          {excluded.size > 0 && (
            <button type="button" onClick={() => setExcluded(new Set())} className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800">
              <RotateCcw className="h-3 w-3" /> {t('segments.results.resetSelection')}
            </button>
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>{t('common.previous')}</Button>
            <span className="text-xs text-neutral-500">{t('segments.results.pageInfo', {page, totalPages})}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>{t('common.next')}</Button>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 pt-4">
        <Button variant="outline" onClick={() => openTargetDialog('schedule')} disabled={preparing || selectedCount === 0}>
          <CalendarClock className="h-4 w-4" /> {t('segments.results.scheduleSend')}
        </Button>
        <Button onClick={() => openTargetDialog('send')} disabled={preparing || selectedCount === 0}>
          {preparing ? <IconSpinner /> : <Send className="h-4 w-4" />} {t('segments.results.sendCampaign')}
        </Button>
      </div>

      {/* Campaign target dialog */}
      <Dialog open={!!dialog?.open} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.intent === 'schedule' ? t('segments.results.dialog.scheduleTitle') : t('segments.results.dialog.sendTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('segments.results.dialog.description', {count: selectedCount.toLocaleString()})}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-sm font-medium text-neutral-900">{t('segments.results.dialog.newTitle')}</p>
              <p className="mb-3 text-xs text-neutral-500">{t('segments.results.dialog.newHelp')}</p>
              <Button className="w-full" onClick={goToNewCampaign}>{t('segments.results.dialog.composeNew')}</Button>
            </div>

            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-sm font-medium text-neutral-900">{t('segments.results.dialog.existingTitle')}</p>
              <p className="mb-3 text-xs text-neutral-500">{t('segments.results.dialog.existingHelp')}</p>
              {draftCampaigns && draftCampaigns.length > 0 ? (
                <div className="flex items-center gap-2">
                  <Select value={selectedDraft} onValueChange={setSelectedDraft}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder={t('segments.results.dialog.selectDraft')} /></SelectTrigger>
                    <SelectContent>
                      {draftCampaigns.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={attachToDraft} disabled={!selectedDraft}>{t('segments.results.dialog.useDraft')}</Button>
                </div>
              ) : (
                <p className="text-xs text-neutral-400">{t('segments.results.dialog.noDrafts')}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Badge variant="neutral">{t('segments.results.dialog.recipients', {count: selectedCount.toLocaleString()})}</Badge>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
