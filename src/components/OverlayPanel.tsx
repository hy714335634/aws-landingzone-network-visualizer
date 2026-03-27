import { useState, useMemo } from 'react';
import {
  ChevronLeft, Plus, Trash2, Wifi, Router, Server, Link2, Globe2,
  ToggleLeft, ToggleRight, AlertTriangle, Zap, ArrowRight, CheckCircle2,
} from 'lucide-react';
import type { OverlayResource, VpnConfig, CgwConfig, VgwConfig, PrivateLinkConfig } from '../types/overlay';
import type { OverlayStore } from '../hooks/useOverlayStore';
import { generateOverlayId } from '../hooks/useOverlayStore';
import type { NetworkConfig, TgwConfig, RouteTableConfig, RegionConfig } from '../types/network';
import OperationGuide from './OperationGuide';
import { useLanguage } from '../i18n/LanguageContext';

interface OverlayPanelProps {
  store: OverlayStore;
  tgwRegions: string[];
  vpcNames: { regionId: string; name: string }[];
  tgwConfigs: Record<string, TgwConfig>;
  config?: NetworkConfig | null;
  onConfigUpdate?: (config: NetworkConfig) => void;
  onFocusOverlay?: (overlayId: string) => void;
}

type FormType = 'vpn' | 'cgw' | 'vgw' | 'privatelink' | null;

const OVERLAY_TYPES: { type: FormType; label: string; descZh: string; descEn: string; icon: React.ReactNode }[] = [
  { type: 'vpn', label: 'Site-to-Site VPN', icon: <Wifi size={16} />, descZh: 'IPSec VPN 隧道', descEn: 'IPSec VPN Tunnel' },
  { type: 'cgw', label: 'Customer Gateway', icon: <Router size={16} />, descZh: '客户侧网关设备', descEn: 'Customer-side Gateway' },
  { type: 'vgw', label: 'Virtual Private GW', icon: <Server size={16} />, descZh: 'VPC 级 VPN 网关', descEn: 'VPC VPN Gateway' },
  { type: 'privatelink', label: 'PrivateLink', icon: <Link2 size={16} />, descZh: '跨账号服务', descEn: 'Cross-account Service' },
];

function overlayIcon(type: string, size = 14) {
  switch (type) {
    case 'vpn': return <Wifi size={size} />;
    case 'cgw': return <Router size={size} />;
    case 'vgw': return <Server size={size} />;
    case 'privatelink': return <Link2 size={size} />;
    case 'cloudwan': return <Globe2 size={size} />;
    default: return null;
  }
}

function overlayLabel(r: OverlayResource): string {
  const c = r.config as Record<string, unknown>;
  return (c.name as string) || r.type;
}

// ============================================
// Connectivity analysis engine
// ============================================

interface ConnectivityAction {
  tableName: string;
  actionType: 'associate' | 'propagate' | 'static-route';
  target: string; // VPC name or VPN name or CIDR
  reason: string;
}

/**
 * Analyze existing route tables and generate a connectivity plan
 * so VPN traffic can reach selected target VPCs and vice versa.
 */
function analyzeConnectivity(
  tgw: TgwConfig,
  targetVpcs: string[],
  vpnName: string,
  routingType: 'bgp' | 'static',
  staticRoutes: string[],
  tFn: (zh: string, en: string) => string,
): { actions: ConnectivityAction[]; vpnTable: string | null } {
  const actions: ConnectivityAction[] = [];
  const tables = tgw.tables || {};
  const tableNames = Object.keys(tables);

  if (tableNames.length === 0) return { actions: [], vpnTable: null };

  // Step 1: Find which route table each target VPC is associated with
  const vpcToTable = new Map<string, string>();
  tableNames.forEach(tName => {
    const t = tables[tName];
    (t.associations || []).forEach(vpc => vpcToTable.set(vpc, tName));
  });

  // Step 2: Determine the best route table for VPN association
  // Strategy: if there's a table that all target VPCs propagate to, use that.
  // Otherwise pick the first table or create a recommendation.
  let vpnTable: string | null = null;

  // Prefer a table where target VPCs already have propagations (the VPCs' traffic table)
  // For a hub-spoke model: VPCs are associated to spoke tables, propagated to hub tables
  // VPN should be associated to the table that receives VPC routes (where VPCs propagate)
  const propagationCounts = new Map<string, number>();
  tableNames.forEach(tName => {
    const t = tables[tName];
    const propVpcs = t.propagations || [];
    const count = targetVpcs.filter(v => propVpcs.includes(v)).length;
    if (count > 0) propagationCounts.set(tName, count);
  });

  // Pick the table with the most target VPC propagations
  if (propagationCounts.size > 0) {
    let best = '';
    let bestCount = 0;
    propagationCounts.forEach((count, tName) => {
      if (count > bestCount) { bestCount = count; best = tName; }
    });
    vpnTable = best;
  } else {
    // Fallback: first table
    vpnTable = tableNames[0];
  }

  // Step 3: Generate actions

  // Action A: Associate VPN to its route table (so VPN can receive routes to VPCs)
  actions.push({
    tableName: vpnTable,
    actionType: 'associate',
    target: `vpn-${vpnName}`,
    reason: tFn(
      `VPN 关联到路由表 "${vpnTable}"，以接收目标 VPC 的路由`,
      `Associate VPN to route table "${vpnTable}" to receive target VPC routes`,
    ),
  });

  // Action B: For each target VPC's associated table, add VPN propagation/routes
  // so that VPC traffic destined for on-prem goes to VPN
  const tablesNeedingVpnRoutes = new Set<string>();
  targetVpcs.forEach(vpc => {
    const assocTable = vpcToTable.get(vpc);
    if (assocTable) {
      tablesNeedingVpnRoutes.add(assocTable);
    }
  });

  tablesNeedingVpnRoutes.forEach(tName => {
    const affectedVpcs = targetVpcs.filter(v => vpcToTable.get(v) === tName);
    if (routingType === 'bgp') {
      actions.push({
        tableName: tName,
        actionType: 'propagate',
        target: `vpn-${vpnName}`,
        reason: tFn(
          `在路由表 "${tName}" 中传播 VPN 路由 (BGP)，使 ${affectedVpcs.join(', ')} 可达 VPN 目标网段`,
          `Propagate VPN routes (BGP) in "${tName}" so ${affectedVpcs.join(', ')} can reach VPN destinations`,
        ),
      });
    } else {
      // Static: add each static route pointing to VPN
      staticRoutes.forEach(cidr => {
        actions.push({
          tableName: tName,
          actionType: 'static-route',
          target: cidr,
          reason: tFn(
            `在路由表 "${tName}" 中添加静态路由 ${cidr} → vpn-${vpnName}，使 ${affectedVpcs.join(', ')} 可达该网段`,
            `Add static route ${cidr} → vpn-${vpnName} in "${tName}" so ${affectedVpcs.join(', ')} can reach this CIDR`,
          ),
        });
      });
    }
  });

  // Action C: In the VPN's table, ensure target VPCs propagate their routes
  // (so VPN knows how to route back to VPCs)
  const vpnTableObj = tables[vpnTable];
  const existingProps = vpnTableObj?.propagations || [];
  targetVpcs.forEach(vpc => {
    if (!existingProps.includes(vpc)) {
      actions.push({
        tableName: vpnTable!,
        actionType: 'propagate',
        target: vpc,
        reason: tFn(
          `在 VPN 路由表 "${vpnTable}" 中传播 ${vpc} 的路由，使 VPN 回程流量可达 ${vpc}`,
          `Propagate ${vpc} routes in VPN table "${vpnTable}" so return traffic can reach ${vpc}`,
        ),
      });
    }
  });

  return { actions, vpnTable };
}

/**
 * Apply connectivity actions to config
 */
function applyConnectivityActions(
  config: NetworkConfig,
  regionId: string,
  vpnName: string,
  actions: ConnectivityAction[],
  customerGatewayIp: string,
  remoteAsn: number,
  routingType: 'bgp' | 'static',
): NetworkConfig {
  const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
  const target = regionId === 'main' ? newConfig : (newConfig[regionId] as RegionConfig);
  if (!target?.tgw?.tables) return newConfig;

  actions.forEach(action => {
    const table = target.tgw!.tables![action.tableName] as RouteTableConfig | undefined;
    if (!table) return;

    switch (action.actionType) {
      case 'associate':
        if (!table.associations) table.associations = [];
        if (!table.associations.includes(action.target)) table.associations.push(action.target);
        break;
      case 'propagate':
        if (!table.propagations) table.propagations = [];
        if (!table.propagations.includes(action.target)) table.propagations.push(action.target);
        break;
      case 'static-route':
        if (!table.routes) table.routes = {};
        table.routes[action.target] = `vpn-${vpnName}`;
        break;
    }
  });

  // Store CGW/VPN reference in TGW connects
  if (!target.tgw!.connects) target.tgw!.connects = {};
  target.tgw!.connects![`vpn-${vpnName}`] = {
    type: 'vpn',
    name: vpnName,
    cgw_ip: customerGatewayIp,
    cgw_asn: remoteAsn,
    routing: routingType,
  } as Record<string, unknown>;

  return newConfig;
}

// ============================================
// Main Component
// ============================================

export default function OverlayPanel({ store, tgwRegions, vpcNames, tgwConfigs, config, onConfigUpdate, onFocusOverlay }: OverlayPanelProps) {
  const { t } = useLanguage();
  const [formType, setFormType] = useState<FormType>(null);
  const [error, setError] = useState('');

  // VPN form
  const [vpnForm, setVpnForm] = useState({
    name: '', tunnels: 2 as 1 | 2, routingType: 'bgp' as 'static' | 'bgp',
    localAsn: '64512', remoteAsn: '65001', customerGatewayIp: '',
    insideCidr1: '169.254.10.0/30', insideCidr2: '169.254.11.0/30',
    staticRoutes: '', attachRegion: tgwRegions[0] || 'main',
    targetVpcs: [] as string[], // connectivity wizard: which VPCs to reach
    writeToConfig: true,
  });

  // Available VPCs in the selected TGW region
  const regionVpcs = useMemo(() => {
    return vpcNames.filter(v => v.regionId === vpnForm.attachRegion).map(v => v.name);
  }, [vpcNames, vpnForm.attachRegion]);

  // Connectivity plan (auto-computed when targetVpcs change)
  const connectivityPlan = useMemo(() => {
    const tgw = tgwConfigs[vpnForm.attachRegion];
    if (!tgw || vpnForm.targetVpcs.length === 0 || !vpnForm.name.trim()) return null;
    const statics = vpnForm.routingType === 'static'
      ? vpnForm.staticRoutes.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    return analyzeConnectivity(tgw, vpnForm.targetVpcs, vpnForm.name, vpnForm.routingType, statics, t);
  }, [tgwConfigs, vpnForm.attachRegion, vpnForm.targetVpcs, vpnForm.name, vpnForm.routingType, vpnForm.staticRoutes, t]);

  const handleAddVpn = () => {
    setError('');
    if (!vpnForm.name.trim()) { setError(t('请输入 VPN 名称', 'Enter VPN name')); return; }
    if (!vpnForm.customerGatewayIp.trim()) { setError(t('请输入客户网关 IP', 'Enter customer gateway IP')); return; }
    const vpnConfig: VpnConfig = {
      name: vpnForm.name,
      tunnels: vpnForm.tunnels,
      routingType: vpnForm.routingType,
      localAsn: parseInt(vpnForm.localAsn) || undefined,
      remoteAsn: parseInt(vpnForm.remoteAsn) || undefined,
      customerGatewayIp: vpnForm.customerGatewayIp,
      insideCidrs: [vpnForm.insideCidr1, ...(vpnForm.tunnels === 2 ? [vpnForm.insideCidr2] : [])].filter(Boolean),
      staticRoutes: vpnForm.routingType === 'static' ? vpnForm.staticRoutes.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    };
    store.addResource({
      id: generateOverlayId('vpn'),
      type: 'vpn',
      attachedTo: `${vpnForm.attachRegion}-tgw`,
      regionId: vpnForm.attachRegion,
      config: vpnConfig,
    });

    // Auto-create CGW if not exists
    const existingCgw = store.resources.find(r =>
      r.type === 'cgw' && (r.config as CgwConfig).ipAddress === vpnForm.customerGatewayIp);
    if (!existingCgw) {
      store.addResource({
        id: generateOverlayId('cgw'),
        type: 'cgw',
        attachedTo: `${vpnForm.attachRegion}-tgw`,
        regionId: vpnForm.attachRegion,
        config: {
          name: `cgw-${vpnForm.name}`,
          bgpAsn: parseInt(vpnForm.remoteAsn) || 65001,
          ipAddress: vpnForm.customerGatewayIp,
          type: 'ipsec.1',
        } as CgwConfig,
      });
    }

    // Apply connectivity plan to JSON config
    if (vpnForm.writeToConfig && config && onConfigUpdate && connectivityPlan && connectivityPlan.actions.length > 0) {
      const newConfig = applyConnectivityActions(
        config,
        vpnForm.attachRegion,
        vpnForm.name,
        connectivityPlan.actions,
        vpnForm.customerGatewayIp,
        parseInt(vpnForm.remoteAsn) || 65001,
        vpnForm.routingType,
      );
      onConfigUpdate(newConfig);
    } else if (vpnForm.writeToConfig && config && onConfigUpdate) {
      // No connectivity plan but still write connects
      const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
      const target = vpnForm.attachRegion === 'main' ? newConfig : (newConfig[vpnForm.attachRegion] as RegionConfig);
      if (target?.tgw) {
        if (!target.tgw.connects) target.tgw.connects = {};
        target.tgw.connects[`vpn-${vpnForm.name}`] = {
          type: 'vpn',
          name: vpnForm.name,
          cgw_ip: vpnForm.customerGatewayIp,
          cgw_asn: parseInt(vpnForm.remoteAsn) || 65001,
          routing: vpnForm.routingType,
        } as Record<string, unknown>;
        onConfigUpdate(newConfig);
      }
    }

    setFormType(null);
    setVpnForm(prev => ({ ...prev, name: '', customerGatewayIp: '', targetVpcs: [] }));
  };

  // CGW form
  const [cgwForm, setCgwForm] = useState({ name: '', bgpAsn: '65001', ipAddress: '', attachRegion: tgwRegions[0] || 'main' });
  const handleAddCgw = () => {
    setError('');
    if (!cgwForm.name.trim()) { setError(t('请输入名称', 'Enter name')); return; }
    if (!cgwForm.ipAddress.trim()) { setError(t('请输入 IP 地址', 'Enter IP address')); return; }
    store.addResource({
      id: generateOverlayId('cgw'),
      type: 'cgw',
      attachedTo: `${cgwForm.attachRegion}-tgw`,
      regionId: cgwForm.attachRegion,
      config: { name: cgwForm.name, bgpAsn: parseInt(cgwForm.bgpAsn) || 65001, ipAddress: cgwForm.ipAddress, type: 'ipsec.1' } as CgwConfig,
    });
    setFormType(null);
  };

  // VGW form
  const [vgwForm, setVgwForm] = useState({ name: '', asn: '', vpcId: vpcNames[0]?.name || '' });
  const handleAddVgw = () => {
    setError('');
    if (!vgwForm.name.trim()) { setError(t('请输入名称', 'Enter name')); return; }
    if (!vgwForm.vpcId) { setError(t('请选择 VPC', 'Select a VPC')); return; }
    const vpc = vpcNames.find(v => v.name === vgwForm.vpcId);
    store.addResource({
      id: generateOverlayId('vgw'),
      type: 'vgw',
      attachedTo: `${vpc?.regionId || 'main'}-${vgwForm.vpcId}`,
      regionId: vpc?.regionId || 'main',
      config: { name: vgwForm.name, asn: parseInt(vgwForm.asn) || undefined, vpcId: vgwForm.vpcId } as VgwConfig,
    });
    setFormType(null);
  };

  // PrivateLink form
  const [plForm, setPlForm] = useState({ name: '', serviceName: '', sourceVpc: '', targetVpc: '' });
  const handleAddPl = () => {
    setError('');
    if (!plForm.name.trim() || !plForm.sourceVpc || !plForm.targetVpc) { setError(t('请填写完整信息', 'Please fill all required fields')); return; }
    const src = vpcNames.find(v => v.name === plForm.sourceVpc);
    store.addResource({
      id: generateOverlayId('privatelink'),
      type: 'privatelink',
      attachedTo: `${src?.regionId || 'main'}-${plForm.sourceVpc}`,
      regionId: src?.regionId || 'main',
      config: { name: plForm.name, serviceName: plForm.serviceName, sourceVpc: plForm.sourceVpc, targetVpc: plForm.targetVpc } as PrivateLinkConfig,
    });
    setFormType(null);
  };

  // Selected resource for guide
  const selectedResource = store.selectedOverlayId
    ? store.resources.find(r => r.id === store.selectedOverlayId)
    : null;
  const selectedTgwConfig = selectedResource
    ? tgwConfigs[selectedResource.regionId]
    : undefined;

  // Resource list
  if (!formType) {
    return (
      <div className="overlay-panel">
        {/* Existing resources */}
        {store.resources.length > 0 && (
          <div className="op-section">
            <div className="op-section-title">{t('已添加的扩展资源', 'Added Overlay Resources')}</div>
            {store.resources.map(r => (
              <div key={r.id}
                className={`op-resource-item ${store.selectedOverlayId === r.id ? 'selected' : ''}`}
                onClick={() => {
                  const newId = r.id === store.selectedOverlayId ? null : r.id;
                  store.selectOverlay(newId);
                  if (newId && onFocusOverlay) onFocusOverlay(newId);
                }}
              >
                <span className={`op-res-icon type-${r.type}`}>{overlayIcon(r.type)}</span>
                <span className="op-res-label">{overlayLabel(r)}</span>
                <span className="op-res-type">{r.type.toUpperCase()}</span>
                <button className="rm-delete-btn" onClick={e => { e.stopPropagation(); store.removeResource(r.id); }}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Operation guide for selected resource */}
        {selectedResource && (
          <div className="op-section">
            <div className="op-section-title">{t('操作指南', 'Operation Guide')}</div>
            <OperationGuide resource={selectedResource} tgwConfig={selectedTgwConfig} />
          </div>
        )}

        {/* Add type selector */}
        <div className="op-section">
          <div className="op-section-title">{t('添加扩展资源', 'Add Overlay Resource')}</div>
          <div className="op-type-grid">
            {OVERLAY_TYPES.map(({ type, label, icon, descZh, descEn }) => (
              <button key={type} className="op-type-btn" onClick={() => { setFormType(type); setError(''); }}>
                <span className="op-type-icon">{icon}</span>
                <span className="op-type-label">{label}</span>
                <span className="op-type-desc">{t(descZh, descEn)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-panel">
      <button className="rm-back-btn" onClick={() => { setFormType(null); setError(''); }}>
        <ChevronLeft size={14} /> {t('返回', 'Back')}
      </button>
      {error && <div className="form-error">{error}</div>}

      {formType === 'vpn' && (
        <div className="rm-form-section">
          <div className="op-form-title"><Wifi size={14} /> Site-to-Site VPN</div>
          <div className="form-group"><label>{t('名称 *', 'Name *')}</label>
            <input className="form-input" value={vpnForm.name} placeholder="vpn-onprem"
              onChange={e => setVpnForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-group"><label>{t('连接到 (TGW 所在区域)', 'Attach to (TGW region)')}</label>
            <select className="form-select" value={vpnForm.attachRegion}
              onChange={e => setVpnForm(p => ({ ...p, attachRegion: e.target.value, targetVpcs: [] }))}>
              {tgwRegions.map(r => <option key={r} value={r}>{r === 'main' ? t('主区域', 'Main') : r}</option>)}
            </select></div>
          <div className="form-group"><label>{t('客户网关 IP *', 'Customer Gateway IP *')}</label>
            <input className="form-input" value={vpnForm.customerGatewayIp} placeholder="203.0.113.1"
              onChange={e => setVpnForm(p => ({ ...p, customerGatewayIp: e.target.value }))} /></div>
          <div className="rm-toggle-grid">
            <label className="rm-toggle-item"><span>{t('双隧道', 'Dual Tunnel')}</span>
              <button className={`rm-toggle-btn ${vpnForm.tunnels === 2 ? 'on' : ''}`}
                onClick={() => setVpnForm(p => ({ ...p, tunnels: p.tunnels === 2 ? 1 : 2 }))}>
                {vpnForm.tunnels === 2 ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
            <label className="rm-toggle-item"><span>BGP</span>
              <button className={`rm-toggle-btn ${vpnForm.routingType === 'bgp' ? 'on' : ''}`}
                onClick={() => setVpnForm(p => ({ ...p, routingType: p.routingType === 'bgp' ? 'static' : 'bgp' }))}>
                {vpnForm.routingType === 'bgp' ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
          </div>
          {vpnForm.routingType === 'bgp' && (<>
            <div className="form-group"><label>{t('本地 ASN (TGW)', 'Local ASN (TGW)')}</label>
              <input className="form-input" value={vpnForm.localAsn}
                onChange={e => setVpnForm(p => ({ ...p, localAsn: e.target.value }))} /></div>
            <div className="form-group"><label>{t('远端 ASN (CGW)', 'Remote ASN (CGW)')}</label>
              <input className="form-input" value={vpnForm.remoteAsn}
                onChange={e => setVpnForm(p => ({ ...p, remoteAsn: e.target.value }))} /></div>
          </>)}
          {vpnForm.routingType === 'static' && (
            <div className="form-group"><label>{t('静态路由 (逗号分隔)', 'Static Routes (comma separated)')}</label>
              <input className="form-input" value={vpnForm.staticRoutes} placeholder="192.168.0.0/16, 172.16.0.0/12"
                onChange={e => setVpnForm(p => ({ ...p, staticRoutes: e.target.value }))} /></div>
          )}
          <div className="form-group"><label>{t('隧道 1 Inside CIDR', 'Tunnel 1 Inside CIDR')}</label>
            <input className="form-input" value={vpnForm.insideCidr1}
              onChange={e => setVpnForm(p => ({ ...p, insideCidr1: e.target.value }))} /></div>
          {vpnForm.tunnels === 2 && (
            <div className="form-group"><label>{t('隧道 2 Inside CIDR', 'Tunnel 2 Inside CIDR')}</label>
              <input className="form-input" value={vpnForm.insideCidr2}
                onChange={e => setVpnForm(p => ({ ...p, insideCidr2: e.target.value }))} /></div>
          )}

          {/* ---- Connectivity Wizard ---- */}
          <div className="op-wizard-section">
            <div className="op-wizard-header">
              <Zap size={13} />
              <span>{t('智能连通', 'Smart Connectivity')}</span>
            </div>
            <div className="op-wizard-desc">
              {t('选择需要与 VPN 打通的 VPC，系统将自动分析路由表并生成连通方案。',
                'Select VPCs to connect with this VPN. The system will analyze route tables and generate a connectivity plan.')}
            </div>
            {regionVpcs.length > 0 ? (
              <div className="form-group"><label>{t('目标 VPC (可多选)', 'Target VPCs (multi-select)')}</label>
                <div className="rm-vpc-chips">
                  {regionVpcs.map(v => {
                    const selected = vpnForm.targetVpcs.includes(v);
                    return (
                      <button key={v} className={`rm-vpc-chip ${selected ? 'active' : ''}`}
                        onClick={() => setVpnForm(p => ({
                          ...p,
                          targetVpcs: selected ? p.targetVpcs.filter(x => x !== v) : [...p.targetVpcs, v],
                        }))}>{v}</button>
                    );
                  })}
                </div></div>
            ) : (
              <div className="op-wizard-empty">{t('该区域暂无 VPC', 'No VPCs in this region')}</div>
            )}

            {/* Connectivity Plan Preview */}
            {connectivityPlan && connectivityPlan.actions.length > 0 && (
              <div className="op-plan-preview">
                <div className="op-plan-title">
                  <CheckCircle2 size={12} />
                  <span>{t(`连通方案 (${connectivityPlan.actions.length} 项变更)`, `Connectivity Plan (${connectivityPlan.actions.length} changes)`)}</span>
                </div>
                {connectivityPlan.vpnTable && (
                  <div className="op-plan-summary">
                    {t(`VPN 将关联到路由表 "${connectivityPlan.vpnTable}"`, `VPN will be associated to route table "${connectivityPlan.vpnTable}"`)}
                  </div>
                )}
                <div className="op-plan-actions">
                  {connectivityPlan.actions.map((action, i) => (
                    <div key={i} className={`op-plan-action op-plan-action-${action.actionType}`}>
                      <span className="op-plan-action-icon">
                        {action.actionType === 'associate' ? <Link2 size={11} /> :
                          action.actionType === 'propagate' ? <ArrowRight size={11} /> :
                          <ArrowRight size={11} />}
                      </span>
                      <span className="op-plan-action-text">
                        <span className="op-plan-action-badge">
                          {action.actionType === 'associate' ? 'ASSOC' :
                            action.actionType === 'propagate' ? 'PROP' : 'ROUTE'}
                        </span>
                        <span className="op-plan-table">{action.tableName}</span>
                        <ArrowRight size={9} />
                        <span className="op-plan-target">{action.target}</span>
                      </span>
                      <div className="op-plan-reason">{action.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {vpnForm.targetVpcs.length > 0 && !vpnForm.name.trim() && (
              <div className="op-wizard-hint">{t('请先输入 VPN 名称以生成连通方案', 'Enter VPN name first to generate connectivity plan')}</div>
            )}
          </div>

          <div className="rm-toggle-grid">
            <label className="rm-toggle-item"><span>{t('写入 JSON 配置', 'Write to JSON')}</span>
              <button className={`rm-toggle-btn ${vpnForm.writeToConfig ? 'on' : ''}`}
                onClick={() => setVpnForm(p => ({ ...p, writeToConfig: !p.writeToConfig }))}>
                {vpnForm.writeToConfig ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
          </div>
          <div className="op-terraform-note">
            <AlertTriangle size={11} />
            <span>{t(
              'Terraform 管理: TGW 连接配置、CGW、路由表关联。手动操作: VPN 隧道参数、预共享密钥、客户端设备配置。',
              'Terraform managed: TGW connect config, CGW, route table associations. Manual: VPN tunnel params, pre-shared keys, on-prem device config.'
            )}</span>
          </div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddVpn}>
            <Plus size={14} /> {t('创建 VPN', 'Create VPN')}
            {connectivityPlan && connectivityPlan.actions.length > 0 && (
              <span className="op-apply-plan-hint">
                {t(`+ ${connectivityPlan.actions.length} 项路由变更`, `+ ${connectivityPlan.actions.length} route changes`)}
              </span>
            )}
          </button>
        </div>
      )}

      {formType === 'cgw' && (
        <div className="rm-form-section">
          <div className="op-form-title"><Router size={14} /> Customer Gateway</div>
          <div className="form-group"><label>{t('名称 *', 'Name *')}</label>
            <input className="form-input" value={cgwForm.name} placeholder="cgw-office"
              onChange={e => setCgwForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-group"><label>BGP ASN</label>
            <input className="form-input" value={cgwForm.bgpAsn}
              onChange={e => setCgwForm(p => ({ ...p, bgpAsn: e.target.value }))} /></div>
          <div className="form-group"><label>{t('IP 地址 *', 'IP Address *')}</label>
            <input className="form-input" value={cgwForm.ipAddress} placeholder="203.0.113.1"
              onChange={e => setCgwForm(p => ({ ...p, ipAddress: e.target.value }))} /></div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddCgw}><Plus size={14} /> {t('创建 CGW', 'Create CGW')}</button>
        </div>
      )}

      {formType === 'vgw' && (
        <div className="rm-form-section">
          <div className="op-form-title"><Server size={14} /> Virtual Private Gateway</div>
          <div className="form-group"><label>{t('名称 *', 'Name *')}</label>
            <input className="form-input" value={vgwForm.name} placeholder="vgw-prod"
              onChange={e => setVgwForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-group"><label>{t('ASN (可选)', 'ASN (optional)')}</label>
            <input className="form-input" value={vgwForm.asn}
              onChange={e => setVgwForm(p => ({ ...p, asn: e.target.value }))} /></div>
          <div className="form-group"><label>{t('关联 VPC *', 'Attach VPC *')}</label>
            <select className="form-select" value={vgwForm.vpcId}
              onChange={e => setVgwForm(p => ({ ...p, vpcId: e.target.value }))}>
              {vpcNames.map(v => <option key={v.name} value={v.name}>{v.name} ({v.regionId})</option>)}
            </select></div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddVgw}><Plus size={14} /> {t('创建 VGW', 'Create VGW')}</button>
        </div>
      )}

      {formType === 'privatelink' && (
        <div className="rm-form-section">
          <div className="op-form-title"><Link2 size={14} /> PrivateLink</div>
          <div className="form-group"><label>{t('名称 *', 'Name *')}</label>
            <input className="form-input" value={plForm.name} placeholder="pl-api-service"
              onChange={e => setPlForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-group"><label>{t('服务名称', 'Service Name')}</label>
            <input className="form-input" value={plForm.serviceName} placeholder="com.amazonaws.vpce.svc-xxx"
              onChange={e => setPlForm(p => ({ ...p, serviceName: e.target.value }))} /></div>
          <div className="form-group"><label>{t('源 VPC *', 'Source VPC *')}</label>
            <select className="form-select" value={plForm.sourceVpc}
              onChange={e => setPlForm(p => ({ ...p, sourceVpc: e.target.value }))}>
              <option value="">{t('选择...', 'Select...')}</option>
              {vpcNames.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select></div>
          <div className="form-group"><label>{t('目标 VPC *', 'Target VPC *')}</label>
            <select className="form-select" value={plForm.targetVpc}
              onChange={e => setPlForm(p => ({ ...p, targetVpc: e.target.value }))}>
              <option value="">{t('选择...', 'Select...')}</option>
              {vpcNames.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select></div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddPl}><Plus size={14} /> {t('创建 PrivateLink', 'Create PrivateLink')}</button>
        </div>
      )}
    </div>
  );
}
