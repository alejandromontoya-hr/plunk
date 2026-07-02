/* eslint-disable @typescript-eslint/no-explicit-any */
import {Button, IconSpinner, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@plunk/ui';
import {AlertTriangle, Info, Plus, Trash2} from 'lucide-react';
import {useMemo, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';

import {useTranslation} from '../../lib/i18n';

import {type EditStepDialogProps, getStepConfig, type StepWithTemplate, StepDialogShell, useStepUpdate} from './shared';

type FieldType = 'string' | 'number' | 'boolean' | 'date';
type ConditionMode = 'binary' | 'multi';

interface AvailableField {
  field: string;
  type: string;
  category: string;
}

interface BranchInput {
  id: string;
  name: string;
  operator: string;
  value: string;
}

interface OperatorOption {
  value: string;
  labelKey: string;
  types: FieldType[];
}

const ALL_OPERATORS: OperatorOption[] = [
  {value: 'equals',             labelKey: 'equals',             types: ['string', 'number', 'boolean', 'date']},
  {value: 'notEquals',          labelKey: 'notEquals',          types: ['string', 'number', 'boolean', 'date']},
  {value: 'contains',           labelKey: 'contains',           types: ['string']},
  {value: 'notContains',        labelKey: 'notContains',        types: ['string']},
  {value: 'greaterThan',        labelKey: 'greaterThan',        types: ['number', 'date']},
  {value: 'lessThan',           labelKey: 'lessThan',           types: ['number', 'date']},
  {value: 'greaterThanOrEqual', labelKey: 'greaterThanOrEqual', types: ['number', 'date']},
  {value: 'lessThanOrEqual',    labelKey: 'lessThanOrEqual',    types: ['number', 'date']},
  {value: 'exists',             labelKey: 'exists',             types: ['string', 'number', 'boolean', 'date']},
  {value: 'notExists',          labelKey: 'notExists',          types: ['string', 'number', 'boolean', 'date']},
];

const NO_VALUE_OPERATORS = ['exists', 'notExists'];

function getOperatorsForType(fieldType: string): OperatorOption[] {
  return ALL_OPERATORS.filter(op => op.types.includes(fieldType as FieldType));
}

function extractInitialField(rawField: unknown): string {
  if (!rawField) return '';
  if (typeof rawField === 'object' && rawField !== null && 'field' in rawField) {
    return String((rawField as {field?: unknown}).field ?? '');
  }
  return String(rawField);
}

function extractInitialBranches(config: Record<string, unknown>): BranchInput[] {
  if (config.mode === 'multi' && Array.isArray(config.branches)) {
    return (config.branches as any[]).map(b => ({
      id:       String(b.id ?? crypto.randomUUID().slice(0, 8)),
      name:     String(b.name ?? ''),
      operator: String(b.operator ?? 'equals'),
      value:    String(b.value ?? ''),
    }));
  }
  return [{id: crypto.randomUUID().slice(0, 8), name: '', operator: 'equals', value: ''}];
}

function parseConditionValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !isNaN(Number(value))) return Number(value);
  return value;
}

function hasMultiBranchConnections(step: StepWithTemplate): boolean {
  if (step.type !== 'CONDITION') return false;
  const config = getStepConfig(step);
  if (config.mode !== 'multi') return false;

  const transitions = (step as any).outgoingTransitions ?? [];
  return transitions.some((t: any) => {
    const condition = t.condition;
    if (condition && typeof condition === 'object' && 'branch' in condition) {
      const branch = String(condition.branch);
      return branch !== 'yes' && branch !== 'no';
    }
    return false;
  });
}

function hasBinaryConnections(step: StepWithTemplate): boolean {
  if (step.type !== 'CONDITION') return false;
  const config = getStepConfig(step);
  if (config.mode === 'multi') return false;

  const transitions = (step as any).outgoingTransitions ?? [];
  return transitions.some((t: any) => {
    const condition = t.condition;
    if (condition && typeof condition === 'object' && 'branch' in condition) {
      const branch = String(condition.branch);
      return branch === 'yes' || branch === 'no';
    }
    return false;
  });
}

export function ConditionStepDialog({step, workflowId, open, onOpenChange, onSuccess}: EditStepDialogProps) {
  const {t} = useTranslation();
  const config = getStepConfig(step);

  const [name, setName] = useState(step.name);
  const [conditionMode, setConditionMode] = useState<ConditionMode>(config.mode === 'multi' ? 'multi' : 'binary');
  const [conditionField, setConditionField] = useState(extractInitialField(config.field));
  const [conditionOperator, setConditionOperator] = useState(String(config.operator ?? 'equals'));
  const [conditionValue, setConditionValue] = useState(String(config.value ?? ''));
  const [conditionBranches, setConditionBranches] = useState<BranchInput[]>(() => extractInitialBranches(config));

  const {data: workflow} = useSWR<{triggerConfig: {eventName?: string} | null}>(
    workflowId ? `/workflows/${workflowId}` : null,
  );

  const triggerEventName = workflow?.triggerConfig?.eventName;
  const fieldsUrl = open
    ? triggerEventName
      ? `/workflows/fields?eventName=${encodeURIComponent(triggerEventName)}`
      : '/workflows/fields'
    : null;

  const {data: fieldsData, isLoading: loadingFields} = useSWR<{fields: string[]; typedFields: AvailableField[]}>(
    fieldsUrl,
    {revalidateOnFocus: false},
  );

  const availableFields: AvailableField[] = useMemo(() => {
    if (!fieldsData) return [];
    return (
      fieldsData.typedFields ??
      fieldsData.fields.map(f => ({field: f, type: 'string', category: 'Unknown'}))
    );
  }, [fieldsData]);

  const {update, isSubmitting} = useStepUpdate(workflowId, step.id);

  const blocksMultiToBinary = hasMultiBranchConnections(step);
  const blocksBinaryToMulti = hasBinaryConnections(step);

  const currentFieldType = availableFields.find(f => f.field === conditionField)?.type ?? 'string';
  const validOperators = useMemo(() => getOperatorsForType(currentFieldType), [currentFieldType]);
  const needsValue = !NO_VALUE_OPERATORS.includes(conditionOperator);

  const handleModeChange = (newMode: ConditionMode) => {
    if (conditionMode === 'multi' && newMode === 'binary' && blocksMultiToBinary) return;
    if (conditionMode === 'binary' && newMode === 'multi' && blocksBinaryToMulti) return;
    setConditionMode(newMode);
  };

  const handleConditionFieldChange = (newField: string) => {
    const newFieldType = availableFields.find(f => f.field === newField)?.type ?? 'string';
    const newValidOperators = getOperatorsForType(newFieldType);

    setConditionField(newField);

    if (!newValidOperators.some(op => op.value === conditionOperator)) {
      setConditionOperator('equals');
    }

    if (newFieldType === 'boolean') {
      setConditionValue('true');
    } else if (currentFieldType === 'boolean' && newFieldType !== 'boolean') {
      setConditionValue('');
    }
  };

  const updateBranch = (id: string, patch: Partial<BranchInput>) => {
    setConditionBranches(prev => prev.map(b => (b.id === id ? {...b, ...patch} : b)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let newConfig: Record<string, unknown>;

    if (conditionMode === 'multi') {
      const validBranches = conditionBranches.filter(b => b.name.trim());
      if (validBranches.length === 0) {
        toast.error(t('workflowSteps.condition.atLeastOneBranchError'));
        return;
      }
      if (!conditionField) {
        toast.error(t('workflowSteps.condition.selectFieldError'));
        return;
      }

      newConfig = {
        mode:     'multi' as const,
        field:    conditionField,
        branches: validBranches.map(b => ({
          id:       b.id,
          name:     b.name.trim(),
          operator: b.operator,
          value:    parseConditionValue(b.value),
        })),
      };
    } else {
      newConfig = {
        field:    conditionField,
        operator: conditionOperator,
        value:    parseConditionValue(conditionValue),
      };
    }

    const ok = await update({name, config: newConfig});

    if (ok) {
      onOpenChange(false);
      onSuccess();
    }
  };

  const initialMode: ConditionMode = config.mode === 'multi' ? 'multi' : 'binary';
  const showWiringWarning =
    conditionMode !== initialMode &&
    !blocksMultiToBinary &&
    !blocksBinaryToMulti &&
    Array.isArray((step as any).outgoingTransitions) &&
    ((step as any).outgoingTransitions as unknown[]).length > 0;

  return (
    <StepDialogShell
      step={step}
      open={open}
      onOpenChange={onOpenChange}
      name={name}
      onNameChange={setName}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <ConditionModeToggle
            mode={conditionMode}
            onChange={handleModeChange}
            blocksMultiToBinary={blocksMultiToBinary}
            blocksBinaryToMulti={blocksBinaryToMulti}
            showWiringWarning={showWiringWarning}
          />

          <ConditionFieldPicker
            value={conditionField}
            onChange={handleConditionFieldChange}
            availableFields={availableFields}
            loading={loadingFields}
          />

          {conditionMode === 'binary' && (
            <BinaryCondition
              operator={conditionOperator}
              value={conditionValue}
              onOperatorChange={setConditionOperator}
              onValueChange={setConditionValue}
              validOperators={validOperators}
              fieldType={currentFieldType}
              needsValue={needsValue}
            />
          )}

          {conditionMode === 'multi' && (
            <MultiBranchEditor
              branches={conditionBranches}
              validOperators={validOperators}
              onUpdateBranch={updateBranch}
              onRemoveBranch={id => setConditionBranches(prev => prev.filter(b => b.id !== id))}
              onAddBranch={() =>
                setConditionBranches(prev => [
                  ...prev,
                  {id: crypto.randomUUID().slice(0, 8), name: '', operator: 'equals', value: ''},
                ])
              }
            />
          )}
        </div>
      </div>
    </StepDialogShell>
  );
}

interface ConditionModeToggleProps {
  mode: ConditionMode;
  onChange: (mode: ConditionMode) => void;
  blocksMultiToBinary: boolean;
  blocksBinaryToMulti: boolean;
  showWiringWarning: boolean;
}

function ConditionModeToggle({
  mode,
  onChange,
  blocksMultiToBinary,
  blocksBinaryToMulti,
  showWiringWarning,
}: ConditionModeToggleProps) {
  const {t} = useTranslation();
  return (
    <div>
      <Label className="text-sm font-medium mb-2 block">{t('workflowSteps.condition.conditionMode')}</Label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange('binary')}
          disabled={mode === 'multi' && blocksMultiToBinary}
          className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
            mode === 'binary'
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : mode === 'multi' && blocksMultiToBinary
                ? 'border-neutral-200 text-neutral-400 bg-neutral-50 cursor-not-allowed opacity-50'
                : 'border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'
          }`}
        >
          {t('workflowSteps.condition.simpleMode')}
        </button>
        <button
          type="button"
          onClick={() => onChange('multi')}
          disabled={mode === 'binary' && blocksBinaryToMulti}
          className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
            mode === 'multi'
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : mode === 'binary' && blocksBinaryToMulti
                ? 'border-neutral-200 text-neutral-400 bg-neutral-50 cursor-not-allowed opacity-50'
                : 'border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'
          }`}
        >
          {t('workflowSteps.condition.multiMode')}
        </button>
      </div>
      <p className="text-xs text-neutral-500 mt-1.5">
        {mode === 'binary'
          ? t('workflowSteps.condition.simpleModeHelp')
          : t('workflowSteps.condition.multiModeHelp')}
      </p>
      {blocksMultiToBinary && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
          <AlertTriangle className="h-3 w-3 inline mr-1" />
          {t('workflowSteps.condition.blocksMultiToBinary')}
        </div>
      )}
      {blocksBinaryToMulti && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
          <AlertTriangle className="h-3 w-3 inline mr-1" />
          {t('workflowSteps.condition.blocksBinaryToMulti')}
        </div>
      )}
      {showWiringWarning && (
        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertTriangle className="h-3 w-3 inline mr-1" />
          {t('workflowSteps.condition.wiringWarning')}
        </div>
      )}
    </div>
  );
}

interface ConditionFieldPickerProps {
  value: string;
  onChange: (value: string) => void;
  availableFields: AvailableField[];
  loading: boolean;
}

function ConditionFieldPicker({value, onChange, availableFields, loading}: ConditionFieldPickerProps) {
  const {t} = useTranslation();
  const grouped = useMemo(() => {
    return availableFields.reduce<Record<string, AvailableField[]>>((acc, field) => {
      if (!acc[field.category]) acc[field.category] = [];
      acc[field.category]!.push(field);
      return acc;
    }, {});
  }, [availableFields]);

  return (
    <div>
      <Label htmlFor="editConditionField">{t('workflowSteps.condition.fieldToCheck')}</Label>
      {loading ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-500 mt-1.5">
          <IconSpinner size="sm" />
          {t('workflowSteps.condition.loadingFields')}
        </div>
      ) : availableFields.length > 0 ? (
        <Select value={value} onValueChange={onChange} required>
          <SelectTrigger id="editConditionField" className="mt-1.5">
            <SelectValue placeholder={t('workflowSteps.condition.selectFieldPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(grouped).map(([category, fields]) => (
              <div key={category}>
                <div className="px-2 py-1.5 text-xs font-semibold text-neutral-500">{category}</div>
                {fields.map(field => (
                  <SelectItem key={field.field} value={field.field}>
                    <div className="flex items-center gap-2">
                      <span>{field.field.replace('contact.', '').replace('data.', '')}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600 font-mono">
                        {field.type}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id="editConditionField"
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          required
          placeholder={t('workflowSteps.condition.fieldPlaceholder')}
          className="mt-1.5"
        />
      )}
    </div>
  );
}

interface BinaryConditionProps {
  operator: string;
  value: string;
  onOperatorChange: (value: string) => void;
  onValueChange: (value: string) => void;
  validOperators: OperatorOption[];
  fieldType: string;
  needsValue: boolean;
}

function BinaryCondition({
  operator,
  value,
  onOperatorChange,
  onValueChange,
  validOperators,
  fieldType,
  needsValue,
}: BinaryConditionProps) {
  const {t} = useTranslation();
  return (
    <>
      <div>
        <Label htmlFor="editConditionOperator">{t('workflowSteps.condition.operator')}</Label>
        <Select value={operator} onValueChange={onOperatorChange}>
          <SelectTrigger id="editConditionOperator" className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {validOperators.map(op => (
              <SelectItem key={op.value} value={op.value}>
                {t(`workflowSteps.condition.operators.${op.labelKey}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {needsValue && (
        <div>
          <Label htmlFor="editConditionValue">{t('workflowSteps.condition.value')}</Label>
          <ConditionValueInput fieldType={fieldType} value={value} onChange={onValueChange} />
        </div>
      )}
    </>
  );
}

interface ConditionValueInputProps {
  fieldType: string;
  value: string;
  onChange: (value: string) => void;
}

function ConditionValueInput({fieldType, value, onChange}: ConditionValueInputProps) {
  const {t} = useTranslation();
  if (fieldType === 'boolean') {
    return (
      <Select value={value || 'true'} onValueChange={onChange}>
        <SelectTrigger id="editConditionValue" className="mt-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t('workflowSteps.condition.booleanTrue')}</SelectItem>
          <SelectItem value="false">{t('workflowSteps.condition.booleanFalse')}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  const inputType = fieldType === 'number' ? 'number' : fieldType === 'date' ? 'datetime-local' : 'text';
  const placeholder =
    fieldType === 'number'
      ? t('workflowSteps.condition.valueNumberPlaceholder')
      : fieldType === 'date'
        ? ''
        : t('workflowSteps.condition.valueStringPlaceholder');

  return (
    <Input
      id="editConditionValue"
      type={inputType}
      value={value}
      onChange={e => onChange(e.target.value)}
      required
      placeholder={placeholder}
      className="mt-1.5"
    />
  );
}

interface MultiBranchEditorProps {
  branches: BranchInput[];
  validOperators: OperatorOption[];
  onUpdateBranch: (id: string, patch: Partial<BranchInput>) => void;
  onRemoveBranch: (id: string) => void;
  onAddBranch: () => void;
}

function MultiBranchEditor({branches, validOperators, onUpdateBranch, onRemoveBranch, onAddBranch}: MultiBranchEditorProps) {
  const {t} = useTranslation();
  return (
    <div className="space-y-3">
      <Label>{t('workflowSteps.condition.branches')}</Label>
      <p className="text-xs text-neutral-500">{t('workflowSteps.condition.branchesHelp')}</p>

      {branches.map((branch, idx) => (
        <div key={branch.id} className="p-3 border border-neutral-200 rounded-lg space-y-3 bg-neutral-50/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500">
              {t('workflowSteps.condition.branchLabel', {index: idx + 1})}
            </span>
            {branches.length > 1 && (
              <Button
                type="button"
                variant="destructiveGhost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onRemoveBranch(branch.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <div>
            <Label className="text-xs">{t('workflowSteps.condition.branchName')}</Label>
            <Input
              type="text"
              value={branch.name}
              onChange={e => onUpdateBranch(branch.id, {name: e.target.value})}
              placeholder={t('workflowSteps.condition.branchNamePlaceholder')}
              className="mt-1 h-8 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('workflowSteps.condition.operator')}</Label>
              <Select
                value={branch.operator}
                onValueChange={val => onUpdateBranch(branch.id, {operator: val})}
              >
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {validOperators.map(op => (
                    <SelectItem key={op.value} value={op.value}>
                      {t(`workflowSteps.condition.operators.${op.labelKey}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!NO_VALUE_OPERATORS.includes(branch.operator) && (
              <div>
                <Label className="text-xs">{t('workflowSteps.condition.value')}</Label>
                <Input
                  type="text"
                  value={branch.value}
                  onChange={e => onUpdateBranch(branch.id, {value: e.target.value})}
                  placeholder={t('workflowSteps.condition.branchValuePlaceholder')}
                  className="mt-1 h-8 text-sm"
                />
              </div>
            )}
          </div>
        </div>
      ))}

      {branches.length < 20 && (
        <button
          type="button"
          onClick={onAddBranch}
          className="flex items-center gap-1.5 text-sm text-neutral-700 hover:text-neutral-900 font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('workflowSteps.condition.addBranch')}
        </button>
      )}

      <div className="p-2 bg-neutral-100 rounded-lg text-xs text-neutral-600 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>
          {t('workflowSteps.condition.branchesEvaluatedInfoPrefix')}
          <strong>{t('workflowSteps.condition.branchesEvaluatedInfoDefault')}</strong>
          {t('workflowSteps.condition.branchesEvaluatedInfoSuffix')}
        </span>
      </div>
    </div>
  );
}
