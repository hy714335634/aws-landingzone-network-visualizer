import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, Cloud, Network, Cable, Server, X } from 'lucide-react';
import type { NetworkConfig, VpcConfig, RegionConfig } from '../types/network';
import { useLanguage } from '../i18n/LanguageContext';

const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

interface SearchResult {
  type: 'vpc' | 'tgw' | 'dx' | 'resolver';
  label: string;
  detail: string;
  regionId: string;
  nodeId: string;
  jsonPath: string;
}

interface SearchOverlayProps {
  config: NetworkConfig;
  onSelect: (nodeId: string, jsonPath: string) => void;
  onClose: () => void;
}

export default function SearchOverlay({ config, onSelect, onClose }: SearchOverlayProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const allItems = useMemo(() => {
    const items: SearchResult[] = [];
    const regions: { id: string; vpcs: Record<string, VpcConfig>; isMain: boolean; prefix: string }[] = [];

    if (config.vpcs) {
      regions.push({ id: 'main', vpcs: config.vpcs, isMain: true, prefix: '' });
    }
    Object.entries(config).forEach(([key, value]) => {
      if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
      if ('vpcs' in value) {
        const rc = value as RegionConfig;
        regions.push({ id: key, vpcs: rc.vpcs || {}, isMain: false, prefix: `${key}.` });
      }
    });

    regions.forEach(r => {
      Object.entries(r.vpcs).forEach(([name, vpc]) => {
        if (vpc.enabled === false) return;
        items.push({
          type: 'vpc', label: name,
          detail: `${vpc.cidr} · ${r.id}${vpc.accounts?.length ? ' · ' + vpc.accounts[0] : ''}`,
          regionId: r.id, nodeId: `${r.id}-${name}`, jsonPath: `${r.prefix}vpcs.${name}`,
        });
      });

      const tgw = r.isMain ? config.tgw : (config[r.id] as RegionConfig)?.tgw;
      if (tgw?.enabled) {
        items.push({
          type: 'tgw', label: `TGW (${r.id})`,
          detail: `ASN ${tgw.asn || '—'} · ${tgw.cidr}`,
          regionId: r.id, nodeId: `${r.id}-tgw`, jsonPath: `${r.prefix}tgw`,
        });
      }
    });

    if (config.dx?.enabled) {
      items.push({
        type: 'dx', label: 'Direct Connect',
        detail: `ASN ${config.dx.asn || '—'}`,
        regionId: 'main', nodeId: 'main-dx', jsonPath: 'dx',
      });
    }
    if (config.resolver) {
      items.push({
        type: 'resolver', label: 'Route 53 Resolver',
        detail: '',
        regionId: 'main', nodeId: 'main-resolver', jsonPath: 'resolver',
      });
    }

    return items;
  }, [config]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.detail.toLowerCase().includes(q) ||
      item.regionId.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && filtered[selectedIdx]) {
      const item = filtered[selectedIdx];
      onSelect(item.nodeId, item.jsonPath);
      onClose();
    }
  }, [filtered, selectedIdx, onSelect, onClose]);

  const iconFor = (type: string) => {
    if (type === 'vpc') return <Cloud size={14} />;
    if (type === 'tgw') return <Network size={14} />;
    if (type === 'dx') return <Cable size={14} />;
    return <Server size={14} />;
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-dialog" onClick={e => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('搜索 VPC、TGW、CIDR、账号 ID...', 'Search VPC, TGW, CIDR, account ID...')}
          />
          <button className="search-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="search-results">
          {filtered.length === 0 && (
            <div className="search-empty">{t('无匹配结果', 'No results')}</div>
          )}
          {filtered.map((item, i) => (
            <div
              key={item.nodeId}
              className={`search-item ${i === selectedIdx ? 'active' : ''}`}
              onClick={() => { onSelect(item.nodeId, item.jsonPath); onClose(); }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className={`search-icon si-${item.type}`}>{iconFor(item.type)}</span>
              <span className="search-label">{item.label}</span>
              <span className="search-detail">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
