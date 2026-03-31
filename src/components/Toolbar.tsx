import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Upload, Edit, Download, ZoomIn, ZoomOut, Maximize, Undo2, Redo2,
  RefreshCw, LayoutGrid, List, Image, ChevronsDownUp, ChevronsUpDown,
  Search, Cloud, Network, Cable, X, GitCompareArrows, Upload as UploadIcon,
} from 'lucide-react';
import type { NetworkConfig, VpcConfig, RegionConfig } from '../types/network';
import { useLanguage } from '../i18n/LanguageContext';

export type ViewMode = 'detailed' | 'simplified';

function DiffDropdown({ showDiff, onDiffToggle, onDiffUpload }: {
  showDiff?: boolean; onDiffToggle?: () => void; onDiffUpload?: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  return (
    <div className="toolbar-dropdown-wrap" ref={ref}>
      <button className={`toolbar-btn ${showDiff ? 'toolbar-btn-active' : ''}`}
        onClick={() => setOpen(!open)} title={t('配置对比', 'Diff')}>
        <GitCompareArrows size={16} />
      </button>
      {open && (
        <div className="toolbar-dropdown">
          <button className="toolbar-dd-item" onClick={() => { onDiffToggle?.(); setOpen(false); }}>
            {showDiff ? t('关闭对比', 'Close Diff') : t('与初始配置对比', 'Compare with Initial')}
          </button>
          <button className="toolbar-dd-item" onClick={() => { onDiffUpload?.(); setOpen(false); }}>
            <UploadIcon size={13} /> {t('上传文件对比', 'Upload File to Compare')}
          </button>
          {showDiff && (
            <button className="toolbar-dd-item toolbar-dd-close" onClick={() => { onDiffToggle?.(); setOpen(false); }}>
              <X size={13} /> {t('关闭对比', 'Close Diff')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

/** Parse CIDR string to numeric range */
function parseCidr(cidr: string): { ip: number; mask: number; prefix: number } | null {
  const m = cidr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!m) return null;
  const [, a, b, c, d, p] = m.map(Number);
  const ip = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  const prefix = p;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { ip: (ip & mask) >>> 0, mask, prefix };
}

function parseIp(ip: string): number | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const [, a, b, c, d] = m.map(Number);
  if ([a, b, c, d].some(x => x > 255)) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function cidrContainsIp(cidr: string, ipNum: number): boolean {
  const c = parseCidr(cidr);
  if (!c) return false;
  return (ipNum & c.mask) >>> 0 === c.ip;
}

interface SearchResult {
  type: 'vpc' | 'tgw' | 'dx';
  label: string;
  detail: string;
  nodeId: string;
  jsonPath: string;
}

interface ToolbarProps {
  onUpload: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onExportSvg: () => void;
  onRefresh: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasConfig: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  editorOpen?: boolean;
  config?: NetworkConfig | null;
  onCollapseAllTables?: () => void;
  onExpandAllTables?: () => void;
  onSearchSelect?: (nodeId: string, jsonPath: string) => void;
  showDiff?: boolean;
  onDiffToggle?: () => void;
  onDiffUpload?: () => void;
}

export default function Toolbar({
  onUpload, onEdit, onDownload, onExportSvg, onRefresh,
  onZoomIn, onZoomOut, onFitView, onUndo, onRedo,
  canUndo, canRedo, hasConfig, viewMode, onViewModeChange, editorOpen,
  config, onCollapseAllTables, onExpandAllTables, onSearchSelect,
  showDiff, onDiffToggle, onDiffUpload,
}: ToolbarProps) {
  const { t } = useLanguage();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ctrl+K opens search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (hasConfig) {
          setSearchOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasConfig]);

  // Close on click outside (including ReactFlow canvas)
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setQuery('');
      }
    };
    // Use capture phase to catch events before ReactFlow swallows them
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [searchOpen]);

  // Build search index
  const allItems = useMemo((): SearchResult[] => {
    if (!config) return [];
    const items: SearchResult[] = [];
    const regions: { id: string; vpcs: Record<string, VpcConfig>; isMain: boolean; prefix: string }[] = [];
    if (config.vpcs) regions.push({ id: 'main', vpcs: config.vpcs, isMain: true, prefix: '' });
    Object.entries(config).forEach(([key, value]) => {
      if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
      if ('vpcs' in value) {
        regions.push({ id: key, vpcs: (value as RegionConfig).vpcs || {}, isMain: false, prefix: `${key}.` });
      }
    });
    regions.forEach(r => {
      Object.entries(r.vpcs).forEach(([name, vpc]) => {
        if (vpc.enabled === false) return;
        items.push({
          type: 'vpc', label: name,
          detail: `${vpc.cidr} · ${r.id}${vpc.accounts?.length ? ' · ' + vpc.accounts[0] : ''}`,
          nodeId: `${r.id}-${name}`, jsonPath: `${r.prefix}vpcs.${name}`,
        });
      });
      const tgw = r.isMain ? config.tgw : (config[r.id] as RegionConfig)?.tgw;
      if (tgw?.enabled) {
        items.push({
          type: 'tgw', label: `TGW (${r.id})`,
          detail: `ASN ${tgw.asn || '—'} · ${tgw.cidr}`,
          nodeId: `${r.id}-tgw`, jsonPath: `${r.prefix}tgw`,
        });
      }
    });
    if (config.dx?.enabled) {
      items.push({ type: 'dx', label: 'Direct Connect', detail: `ASN ${config.dx.asn || '—'}`, nodeId: 'main-dx', jsonPath: 'dx' });
    }
    return items;
  }, [config]);

  // Filter with IP containment support
  const filtered = useMemo(() => {
    if (!query.trim()) return searchOpen ? allItems : [];
    const q = query.trim().toLowerCase();

    // Check if query is a bare IP address (no mask)
    const ipNum = parseIp(q);
    if (ipNum !== null) {
      return allItems.filter(item => {
        // Extract CIDR from detail string
        const cidrMatch = item.detail.match(/(\d+\.\d+\.\d+\.\d+\/\d+)/);
        if (cidrMatch && cidrContainsIp(cidrMatch[1], ipNum)) return true;
        return item.label.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q);
      });
    }

    return allItems.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.detail.toLowerCase().includes(q)
    );
  }, [allItems, query, searchOpen]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const handleSelect = useCallback((item: SearchResult) => {
    onSearchSelect?.(item.nodeId, item.jsonPath);
    setSearchOpen(false);
    setQuery('');
  }, [onSearchSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && filtered[selectedIdx]) { handleSelect(filtered[selectedIdx]); }
  }, [filtered, selectedIdx, handleSelect]);

  const iconFor = (type: string) => {
    if (type === 'vpc') return <Cloud size={12} />;
    if (type === 'tgw') return <Network size={12} />;
    return <Cable size={12} />;
  };

  return (
    <div className={`toolbar ${editorOpen ? 'toolbar-shifted' : ''}`}>
      <div className="toolbar-group">
        <button className="toolbar-btn toolbar-btn-labeled" onClick={onUpload}>
          <Upload size={16} />
          <span className="toolbar-label">{t('上传', 'Upload')}</span>
        </button>
        {hasConfig && (
          <>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onRefresh}>
              <RefreshCw size={16} />
              <span className="toolbar-label">{t('刷新', 'Refresh')}</span>
            </button>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onEdit}>
              <Edit size={16} />
              <span className="toolbar-label">JSON</span>
            </button>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onDownload}>
              <Download size={16} />
              <span className="toolbar-label">{t('下载', 'Save')}</span>
            </button>
            <button className="toolbar-btn toolbar-btn-labeled" onClick={onExportSvg}>
              <Image size={16} />
              <span className="toolbar-label">SVG</span>
            </button>
          </>
        )}
      </div>

      {hasConfig && (
        <div className="toolbar-group">
          <div className="view-toggle">
            <button className={`view-toggle-btn ${viewMode === 'detailed' ? 'active' : ''}`}
              onClick={() => onViewModeChange('detailed')}>
              <List size={14} /><span>{t('详细', 'Detail')}</span>
            </button>
            <button className={`view-toggle-btn ${viewMode === 'simplified' ? 'active' : ''}`}
              onClick={() => onViewModeChange('simplified')}>
              <LayoutGrid size={14} /><span>{t('拓扑', 'Topo')}</span>
            </button>
          </div>
        </div>
      )}

      {hasConfig && (
        <div className="toolbar-group">
          <button className={`toolbar-btn toolbar-btn-labeled ${!canUndo ? 'disabled' : ''}`} onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={16} /><span className="toolbar-label">{t('撤销', 'Undo')}</span>
          </button>
          <button className={`toolbar-btn toolbar-btn-labeled ${!canRedo ? 'disabled' : ''}`} onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={16} /><span className="toolbar-label">{t('重做', 'Redo')}</span>
          </button>
        </div>
      )}

      {hasConfig && (
        <div className="toolbar-group">
          {/* Collapse/Expand */}
          {viewMode === 'detailed' && (
            <>
              <button className="toolbar-btn" onClick={onCollapseAllTables} title={t('折叠路由表', 'Collapse Tables')}>
                <ChevronsDownUp size={16} />
              </button>
              <button className="toolbar-btn" onClick={onExpandAllTables} title={t('展开路由表', 'Expand Tables')}>
                <ChevronsUpDown size={16} />
              </button>
            </>
          )}
          {/* Diff dropdown */}
          <DiffDropdown showDiff={showDiff} onDiffToggle={onDiffToggle} onDiffUpload={onDiffUpload} />
          {/* Zoom */}
          <button className="toolbar-btn" onClick={onZoomIn} title={t('放大', 'Zoom In')}><ZoomIn size={16} /></button>
          <button className="toolbar-btn" onClick={onZoomOut} title={t('缩小', 'Zoom Out')}><ZoomOut size={16} /></button>
          <button className="toolbar-btn" onClick={onFitView} title={t('适应视图', 'Fit View')}><Maximize size={16} /></button>
        </div>
      )}

      {/* Search box */}
      {hasConfig && (
        <div className="toolbar-search-wrap" ref={containerRef}>
          <div className={`toolbar-search ${searchOpen ? 'open' : ''}`}>
            <Search size={14} />
            <input
              ref={inputRef}
              className="toolbar-search-input"
              value={query}
              onChange={e => { setQuery(e.target.value); if (!searchOpen) setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={t('搜索资源 (⌘K)', 'Search (⌘K)')}
            />
            {query && (
              <button className="toolbar-search-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                <X size={12} />
              </button>
            )}
          </div>
          {searchOpen && filtered.length > 0 && (
            <div className="toolbar-search-results">
              {filtered.slice(0, 12).map((item, i) => (
                <div key={item.nodeId}
                  className={`toolbar-search-item ${i === selectedIdx ? 'active' : ''}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIdx(i)}>
                  <span className={`tsi-icon tsi-${item.type}`}>{iconFor(item.type)}</span>
                  <span className="tsi-label">{item.label}</span>
                  <span className="tsi-detail">{item.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
