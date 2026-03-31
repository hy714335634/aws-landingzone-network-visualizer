import { useState, useMemo, useCallback } from 'react';
import {
  Search, ArrowDown, CheckCircle2, XCircle, Network, Cloud,
  ChevronRight, MapPin, Waypoints, RotateCcw, ArrowRightLeft,
} from 'lucide-react';
import type { NetworkConfig } from '../types/network';
import { analyzeReachability, getAvailableEndpoints } from '../utils/reachabilityAnalyzer';
import type { Endpoint, ReachabilityResult } from '../utils/reachabilityAnalyzer';
import { useLanguage } from '../i18n/LanguageContext';

interface ReachabilityPanelProps {
  config: NetworkConfig;
  onHighlightPath: (result: ReachabilityResult) => void;
  onClearHighlight: () => void;
}

export default function ReachabilityPanel({ config, onHighlightPath, onClearHighlight }: ReachabilityPanelProps) {
  const { t } = useLanguage();
  const [srcType, setSrcType] = useState<'vpc' | 'tgw' | 'ip'>('vpc');
  const [srcRegion, setSrcRegion] = useState('main');
  const [srcName, setSrcName] = useState('');
  const [srcIp, setSrcIp] = useState('');

  const [dstType, setDstType] = useState<'vpc' | 'tgw' | 'ip'>('vpc');
  const [dstRegion, setDstRegion] = useState('main');
  const [dstName, setDstName] = useState('');
  const [dstIp, setDstIp] = useState('');

  const [forwardResult, setForwardResult] = useState<ReachabilityResult | null>(null);
  const [returnResult, setReturnResult] = useState<ReachabilityResult | null>(null);
  const [activeDirection, setActiveDirection] = useState<'forward' | 'return'>('forward');

  const { vpcs, tgws } = useMemo(() => getAvailableEndpoints(config), [config]);

  const srcRegionVpcs = useMemo(() => vpcs.filter(v => v.regionId === srcRegion), [vpcs, srcRegion]);
  const dstRegionVpcs = useMemo(() => vpcs.filter(v => v.regionId === dstRegion), [vpcs, dstRegion]);
  const allRegions = useMemo(() => {
    const set = new Set<string>();
    vpcs.forEach(v => set.add(v.regionId));
    tgws.forEach(t => set.add(t.regionId));
    return Array.from(set);
  }, [vpcs, tgws]);

  const buildEndpoint = useCallback((type: 'vpc' | 'tgw' | 'ip', regionId: string, name: string, ip: string): Endpoint | null => {
    if (type === 'vpc') {
      if (!name) return null;
      return { type: 'vpc', regionId, name };
    }
    if (type === 'tgw') {
      return { type: 'tgw', regionId, name: 'tgw' };
    }
    if (!ip.trim()) return null;
    const cidr = ip.includes('/') ? ip : `${ip}/32`;
    return { type: 'ip', regionId: '', name: ip, cidr };
  }, []);

  const handleAnalyze = useCallback(() => {
    onClearHighlight();
    const src = buildEndpoint(srcType, srcRegion, srcName, srcIp);
    const dst = buildEndpoint(dstType, dstRegion, dstName, dstIp);
    if (!src || !dst) return;

    // Forward: src → dst
    const fwd = analyzeReachability(config, src, dst, t);
    setForwardResult(fwd);

    // Return: dst → src
    const ret = analyzeReachability(config, dst, src, t);
    setReturnResult(ret);

    setActiveDirection('forward');
    if (fwd.nodeIds.length > 0 || fwd.edgeIds.length > 0) {
      onHighlightPath(fwd);
    }
  }, [config, srcType, srcRegion, srcName, srcIp, dstType, dstRegion, dstName, dstIp, t, buildEndpoint, onHighlightPath, onClearHighlight]);

  const handleDirectionChange = useCallback((dir: 'forward' | 'return') => {
    setActiveDirection(dir);
    const res = dir === 'forward' ? forwardResult : returnResult;
    if (res && (res.nodeIds.length > 0 || res.edgeIds.length > 0)) {
      onHighlightPath(res);
    } else {
      onClearHighlight();
    }
  }, [forwardResult, returnResult, onHighlightPath, onClearHighlight]);

  const handleClear = useCallback(() => {
    setForwardResult(null);
    setReturnResult(null);
    onClearHighlight();
  }, [onClearHighlight]);

  const activeResult = activeDirection === 'forward' ? forwardResult : returnResult;

  const renderEndpointSelector = (
    prefix: string,
    type: 'vpc' | 'tgw' | 'ip',
    setType: (t: 'vpc' | 'tgw' | 'ip') => void,
    region: string,
    setRegion: (r: string) => void,
    name: string,
    setName: (n: string) => void,
    ip: string,
    setIp: (ip: string) => void,
    regionVpcs: { regionId: string; name: string; cidr: string }[],
  ) => (
    <div className="ra-endpoint">
      <div className="ra-endpoint-header">
        <MapPin size={13} />
        <span>{prefix}</span>
      </div>
      <div className="ra-type-row">
        {(['vpc', 'tgw', 'ip'] as const).map(tp => (
          <button key={tp} className={`ra-type-btn ${type === tp ? 'active' : ''}`}
            onClick={() => { setType(tp); setName(''); setIp(''); }}>
            {tp === 'vpc' ? <Cloud size={12} /> : tp === 'tgw' ? <Network size={12} /> : <Waypoints size={12} />}
            {tp.toUpperCase()}
          </button>
        ))}
      </div>
      {type !== 'ip' && (
        <select className="form-select ra-select" value={region}
          onChange={e => { setRegion(e.target.value); setName(''); }}>
          {allRegions.map(r => <option key={r} value={r}>{r === 'main' ? t('主区域 (Main)', 'Main Region') : r}</option>)}
        </select>
      )}
      {type === 'vpc' && (
        <select className="form-select ra-select" value={name}
          onChange={e => setName(e.target.value)}>
          <option value="">{t('选择 VPC...', 'Select VPC...')}</option>
          {regionVpcs.map(v => (
            <option key={v.name} value={v.name}>{v.name} ({v.cidr})</option>
          ))}
        </select>
      )}
      {type === 'ip' && (
        <input className="form-input ra-input" value={ip} placeholder="10.0.1.0/24 or 10.0.1.5"
          onChange={e => setIp(e.target.value)} />
      )}
    </div>
  );

  const renderResult = (result: ReachabilityResult | null) => {
    if (!result) return null;
    return (
      <>
        <div className={`ra-status ${result.reachable ? 'reachable' : 'unreachable'}`}>
          {result.reachable
            ? <><CheckCircle2 size={16} /> {t('可达', 'Reachable')}</>
            : <><XCircle size={16} /> {t('不可达', 'Unreachable')}</>
          }
        </div>

        {result.errors.length > 0 && (
          <div className="ra-errors">
            {result.errors.map((err, i) => (
              <div key={i} className="ra-error-item">{err}</div>
            ))}
          </div>
        )}

        {result.path.length > 0 && (
          <div className="ra-path">
            <div className="ra-path-title">{t('路径跟踪', 'Path Trace')}</div>
            {result.path.map((hop, i) => (
              <div key={i} className="ra-hop">
                <div className="ra-hop-line">
                  <div className={`ra-hop-dot ${hop.type}`} />
                  {i < result.path.length - 1 && <div className="ra-hop-connector" />}
                </div>
                <div className="ra-hop-content">
                  <div className="ra-hop-header">
                    {hop.type === 'vpc' && <Cloud size={13} />}
                    {hop.type === 'tgw' && <Network size={13} />}
                    {hop.type === 'tgw-peering' && <Waypoints size={13} />}
                    <span className="ra-hop-name">{hop.name}</span>
                    <span className="ra-hop-region">{hop.regionId}</span>
                  </div>
                  {hop.routeTable && (
                    <div className="ra-hop-route">
                      <div className="ra-route-table">
                        <ChevronRight size={11} />
                        <span>{t('路由表', 'Table')}: <b>{hop.routeTable.tableName}</b></span>
                      </div>
                      {hop.routeTable.matchedRoute ? (
                        <div className="ra-route-match">
                          <span className={`ra-match-badge ${hop.routeTable.matchType}`}>
                            {hop.routeTable.matchType === 'static' ? t('静态路由', 'Static') : t('传播路由', 'Propagated')}
                          </span>
                          <span className="ra-route-rule">
                            {hop.routeTable.matchedRoute.displayKey}
                            <ChevronRight size={10} />
                            {hop.routeTable.matchedRoute.displayTarget}
                          </span>
                        </div>
                      ) : (
                        <div className="ra-route-nomatch">{t('无匹配路由', 'No matching route')}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="ra-panel">
      <div className="ra-desc">
        <Waypoints size={14} />
        <span>{t('分析两个端点之间的网络路径和路由连通性', 'Analyze network path and route connectivity between two endpoints')}</span>
      </div>

      {renderEndpointSelector(
        t('源 (Source)', 'Source'),
        srcType, setSrcType, srcRegion, setSrcRegion, srcName, setSrcName, srcIp, setSrcIp, srcRegionVpcs,
      )}

      <div className="ra-arrow"><ArrowDown size={16} /></div>

      {renderEndpointSelector(
        t('目标 (Destination)', 'Destination'),
        dstType, setDstType, dstRegion, setDstRegion, dstName, setDstName, dstIp, setDstIp, dstRegionVpcs,
      )}

      <div className="ra-actions">
        <button className="btn btn-primary ra-analyze-btn" onClick={handleAnalyze}>
          <Search size={14} /> {t('分析路径', 'Analyze Path')}
        </button>
        {forwardResult && (
          <button className="btn ra-clear-btn" onClick={handleClear}>
            <RotateCcw size={14} /> {t('清除', 'Clear')}
          </button>
        )}
      </div>

      {/* Direction tabs + Results */}
      {forwardResult && (
        <div className="ra-result">
          <div className="ra-dir-tabs">
            <button
              className={`ra-dir-tab ${activeDirection === 'forward' ? 'active' : ''}`}
              onClick={() => handleDirectionChange('forward')}
            >
              <ArrowDown size={12} />
              {t('去程', 'Forward')}
              {forwardResult && (
                <span className={`ra-dir-badge ${forwardResult.reachable ? 'ok' : 'fail'}`}>
                  {forwardResult.reachable ? '✓' : '✗'}
                </span>
              )}
            </button>
            <button
              className={`ra-dir-tab ${activeDirection === 'return' ? 'active' : ''}`}
              onClick={() => handleDirectionChange('return')}
            >
              <ArrowRightLeft size={12} />
              {t('回程', 'Return')}
              {returnResult && (
                <span className={`ra-dir-badge ${returnResult.reachable ? 'ok' : 'fail'}`}>
                  {returnResult.reachable ? '✓' : '✗'}
                </span>
              )}
            </button>
          </div>

          {renderResult(activeResult)}
        </div>
      )}
    </div>
  );
}
