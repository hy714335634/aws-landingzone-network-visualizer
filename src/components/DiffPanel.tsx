import { useState, useMemo, useCallback } from 'react';
import {
  PlusCircle, MinusCircle, Edit3, ChevronDown, ChevronRight,
  Cloud, Network, Layers, Globe, Cable, Server,
} from 'lucide-react';
import type { NetworkConfig } from '../types/network';
import { diffConfigs } from '../utils/configDiff';
import type { DiffSummary, ResourceDiff, FieldDiff } from '../utils/configDiff';
import { useLanguage } from '../i18n/LanguageContext';

interface DiffPanelProps {
  currentConfig: NetworkConfig;
  baseConfig: NetworkConfig;
  baseName?: string;
  onFocusNode?: (nodeId: string) => void;
}

function kindIcon(kind: string) {
  if (kind === 'VPC') return <Cloud size={13} />;
  if (kind === 'TGW') return <Network size={13} />;
  if (kind === 'Route Table') return <Layers size={13} />;
  if (kind === 'Region') return <Globe size={13} />;
  if (kind === 'DX') return <Cable size={13} />;
  return <Server size={13} />;
}

function changeIcon(ct: string) {
  if (ct === 'added') return <PlusCircle size={12} />;
  if (ct === 'removed') return <MinusCircle size={12} />;
  return <Edit3 size={12} />;
}

function FieldDiffRow({ field }: { field: FieldDiff }) {
  const shortPath = field.path.split('.').slice(-1)[0];
  return (
    <div className={`diff-field diff-field-${field.type}`}>
      <span className="diff-field-icon">
        {field.type === 'added' ? '+' : field.type === 'removed' ? '−' : '~'}
      </span>
      <span className="diff-field-path">{shortPath}</span>
      {field.type === 'removed' && field.displayOld && (
        <span className="diff-field-old">{field.displayOld}</span>
      )}
      {field.type === 'added' && field.displayNew && (
        <span className="diff-field-new">{field.displayNew}</span>
      )}
      {field.type === 'changed' && (
        <>
          <span className="diff-field-old">{field.displayOld}</span>
          <span className="diff-field-arrow">→</span>
          <span className="diff-field-new">{field.displayNew}</span>
        </>
      )}
    </div>
  );
}

function ResourceDiffItem({ rd, onFocus }: { rd: ResourceDiff; onFocus?: (nodeId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  return (
    <div className={`diff-resource diff-resource-${rd.changeType}`}>
      <div className="diff-resource-header" onClick={() => { setExpanded(!expanded); onFocus?.(rd.nodeId); }}>
        <button className="diff-expand-btn" onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className={`diff-change-icon diff-ci-${rd.changeType}`}>{changeIcon(rd.changeType)}</span>
        <span className="diff-resource-name">{rd.name}</span>
        <span className="diff-resource-region">{rd.regionId}</span>
        {rd.fields.length > 0 && !expanded && (
          <span className="diff-field-count">
            {rd.fields.length} {t('项变更', 'changes')}
          </span>
        )}
      </div>
      {expanded && rd.fields.length > 0 && (
        <div className="diff-fields">
          {rd.fields.map((f, i) => <FieldDiffRow key={i} field={f} />)}
        </div>
      )}
    </div>
  );
}

export default function DiffPanel({ currentConfig, baseConfig, baseName, onFocusNode }: DiffPanelProps) {
  const { t } = useLanguage();

  const diff: DiffSummary = useMemo(
    () => diffConfigs(baseConfig, currentConfig),
    [baseConfig, currentConfig],
  );

  // Group by kind
  const groups = useMemo(() => {
    const map = new Map<string, ResourceDiff[]>();
    diff.resources.forEach(r => {
      if (!map.has(r.kind)) map.set(r.kind, []);
      map.get(r.kind)!.push(r);
    });
    return map;
  }, [diff]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(groups.keys()));

  const toggleGroup = useCallback((kind: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  }, []);

  if (diff.resources.length === 0) {
    return (
      <div className="diff-panel">
        <div className="diff-empty">{t('两个配置完全一致，无差异', 'Configurations are identical — no differences')}</div>
      </div>
    );
  }

  return (
    <div className="diff-panel">
      {/* Summary bar */}
      <div className="diff-summary">
        <div className="diff-summary-counts">
          {diff.added > 0 && <span className="diff-count diff-count-added">{diff.added} {t('新增', 'added')}</span>}
          {diff.modified > 0 && <span className="diff-count diff-count-modified">{diff.modified} {t('修改', 'modified')}</span>}
          {diff.removed > 0 && <span className="diff-count diff-count-removed">{diff.removed} {t('删除', 'removed')}</span>}
        </div>
        {baseName && <div className="diff-base-label">{t('对比基准', 'Base')}: {baseName}</div>}
      </div>

      {/* Grouped list */}
      <div className="diff-groups">
        {[...groups.entries()].map(([kind, items]) => (
          <div key={kind} className="diff-group">
            <div className="diff-group-header" onClick={() => toggleGroup(kind)}>
              {expandedGroups.has(kind) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {kindIcon(kind)}
              <span className="diff-group-name">{kind}</span>
              <span className="diff-group-count">
                {items.length} {t('项变更', 'changes')}
              </span>
            </div>
            {expandedGroups.has(kind) && (
              <div className="diff-group-items">
                {items.map((rd, i) => (
                  <ResourceDiffItem key={i} rd={rd} onFocus={onFocusNode} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
