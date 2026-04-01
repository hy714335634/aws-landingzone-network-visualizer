import { useState, useCallback, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevronRightIcon,
  Plus, Trash2, Save, FolderTree, Globe, Cloud, Network, Radio, Cable,
  Shield, Layers, Link2, Server, Settings, ToggleLeft, ToggleRight, Wifi,
  GitCommit, PlusCircle, MinusCircle, Edit3, Waypoints, GitCompareArrows,
} from 'lucide-react';
import type {
  NetworkConfig, VpcConfig, TgwConfig, ResolverConfig, DxConfig,
  RouteTableConfig, RegionConfig, SubnetsConfig,
} from '../types/network';
import SubnetEditor from './SubnetEditor';
import OverlayPanel from './OverlayPanel';
import ReachabilityPanel from './ReachabilityPanel';
import DiffPanel from './DiffPanel';
import type { OverlayStore } from '../hooks/useOverlayStore';
import { useLanguage } from '../i18n/LanguageContext';
import type { ChangeLogEntry } from './NetworkFlow';
import type { ReachabilityResult } from '../utils/reachabilityAnalyzer';

// ============================================
// Types
// ============================================

type ResourceKind =
  | 'region' | 'vpc' | 'tgw' | 'tgw-table' | 'tgw-connect'
  | 'resolver' | 'dx' | 'subnet-type' | 'component'
  | 'vpc-peers' | 'vpc-endpoints';

interface TreeItem {
  id: string;         // unique key for tree state
  kind: ResourceKind;
  label: string;
  jsonPath: string;   // e.g. "vpcs.hub" or "tgw.tables.pre"
  regionId: string;
  icon: 'region' | 'vpc' | 'tgw' | 'table' | 'connect' | 'resolver' | 'dx' | 'subnet' | 'component' | 'peer' | 'endpoint';
  badge?: string;     // e.g. "✅" or "❌" or count
  children?: TreeItem[];
  depth: number;
}

interface ResourceManagerProps {
  config: NetworkConfig | null;
  onConfigUpdate: (config: NetworkConfig) => void;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onFocusOverlay?: (overlayId: string) => void;
  overlayStore: OverlayStore;
  changeLog?: ChangeLogEntry[];
  onHighlightPath?: (result: ReachabilityResult) => void;
  onClearHighlight?: () => void;
  diffBaseConfig?: NetworkConfig | null;
  diffBaseName?: string;
  showDiff?: boolean;
  onFocusNode?: (nodeId: string) => void;
}

// ============================================
// Constants
// ============================================

const ROOT_LEVEL_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

const COMPONENT_TYPES = [
  { key: 'igw', label: 'IGW', color: '#22c55e' },
  { key: 'nat', label: 'NAT', color: '#8b5cf6' },
  { key: 'nfw', label: 'NFW', color: '#ef4444' },
  { key: 'gwlb', label: 'GWLB', color: '#3b82f6' },
] as const;

// ============================================
// Helper: Build tree from config
// ============================================

function buildTree(config: NetworkConfig, tFn: (zh: string, en: string) => string): TreeItem[] {
  const items: TreeItem[] = [];

  // Collect all regions
  const regions: { id: string; label: string; vpcs: Record<string, VpcConfig>; tgw?: TgwConfig; resolver?: ResolverConfig; dx?: DxConfig; isMain: boolean }[] = [];

  if (config.vpcs) {
    regions.push({
      id: 'main', label: tFn('主区域 (Main)', 'Main Region'), vpcs: config.vpcs,
      tgw: config.tgw, resolver: config.resolver, dx: config.dx, isMain: true,
    });
  }

  Object.entries(config).forEach(([key, value]) => {
    if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
    if (!('vpcs' in value)) return;
    const rc = value as RegionConfig;
    regions.push({
      id: key, label: key, vpcs: rc.vpcs || {},
      tgw: rc.tgw, resolver: rc.resolver, isMain: false,
    });
  });

  regions.forEach((region) => {
    const regionChildren: TreeItem[] = [];
    const regionPrefix = region.isMain ? '' : `${region.id}.`;

    // VPCs
    Object.entries(region.vpcs).forEach(([vpcName, vpcConfig]) => {
      if (vpcConfig.enabled === false) return;
      const vpcChildren: TreeItem[] = [];
      const vpcPath = region.isMain ? `vpcs.${vpcName}` : `${region.id}.vpcs.${vpcName}`;

      // Components
      COMPONENT_TYPES.forEach(({ key, label }) => {
        const comp = vpcConfig[key as keyof VpcConfig] as { enabled?: boolean } | undefined;
        const enabled = comp?.enabled;
        vpcChildren.push({
          id: `${region.id}-${vpcName}-${key}`,
          kind: 'component',
          label,
          jsonPath: `${vpcPath}.${key}`,
          regionId: region.id,
          icon: 'component',
          badge: enabled ? '✅' : '—',
          depth: 2,
        });
      });

      // Subnets summary
      const subnets = vpcConfig.subnets;
      if (subnets) {
        const subnetCount = Array.isArray(subnets)
          ? subnets.filter(s => s && s.length > 0).length
          : Object.keys(subnets).length;
        vpcChildren.push({
          id: `${region.id}-${vpcName}-subnets`,
          kind: 'subnet-type',
          label: tFn(`子网 (${subnetCount} 类型)`, `Subnets (${subnetCount} types)`),
          jsonPath: `${vpcPath}.subnets`,
          regionId: region.id,
          icon: 'subnet',
          depth: 2,
        });
      }

      // Peers
      if (vpcConfig.peers?.length) {
        vpcChildren.push({
          id: `${region.id}-${vpcName}-peers`,
          kind: 'vpc-peers',
          label: `Peering (${vpcConfig.peers.length})`,
          jsonPath: `${vpcPath}.peers`,
          regionId: region.id,
          icon: 'peer',
          depth: 2,
        });
      }

      // Endpoints
      const epCount = (vpcConfig.endpoints?.length || 0) + (vpcConfig.gw_endpoints?.length || 0);
      if (epCount > 0) {
        vpcChildren.push({
          id: `${region.id}-${vpcName}-endpoints`,
          kind: 'vpc-endpoints',
          label: `Endpoints (${epCount})`,
          jsonPath: `${vpcPath}.endpoints`,
          regionId: region.id,
          icon: 'endpoint',
          depth: 2,
        });
      }

      const hubBadge = vpcConfig.is_hub ? ' [Hub]' : vpcConfig.is_endpoint ? ' [EP]' : '';
      regionChildren.push({
        id: `${region.id}-${vpcName}`,
        kind: 'vpc',
        label: `${vpcName}${hubBadge}`,
        jsonPath: vpcPath,
        regionId: region.id,
        icon: 'vpc',
        badge: vpcConfig.cidr,
        children: vpcChildren,
        depth: 1,
      });
    });

    // TGW
    if (region.tgw?.enabled) {
      const tgwChildren: TreeItem[] = [];
      const tgwPath = `${regionPrefix}tgw`;

      if (region.tgw.tables) {
        Object.entries(region.tgw.tables).forEach(([tableName]) => {
          tgwChildren.push({
            id: `${region.id}-tgw-table-${tableName}`,
            kind: 'tgw-table',
            label: tableName,
            jsonPath: `${tgwPath}.tables.${tableName}`,
            regionId: region.id,
            icon: 'table',
            depth: 2,
          });
        });
      }

      if (region.tgw.connects) {
        Object.entries(region.tgw.connects).forEach(([connName]) => {
          tgwChildren.push({
            id: `${region.id}-tgw-connect-${connName}`,
            kind: 'tgw-connect',
            label: connName,
            jsonPath: `${tgwPath}.connects.${connName}`,
            regionId: region.id,
            icon: 'connect',
            depth: 2,
          });
        });
      }

      regionChildren.push({
        id: `${region.id}-tgw`,
        kind: 'tgw',
        label: `TGW${region.tgw.peer ? ' (Peer)' : ''}`,
        jsonPath: tgwPath,
        regionId: region.id,
        icon: 'tgw',
        badge: region.tgw.asn ? `ASN ${region.tgw.asn}` : undefined,
        children: tgwChildren,
        depth: 1,
      });
    }

    // Resolver (main only typically)
    if (region.resolver) {
      regionChildren.push({
        id: `${region.id}-resolver`,
        kind: 'resolver',
        label: 'Route 53 Resolver',
        jsonPath: `${regionPrefix}resolver`,
        regionId: region.id,
        icon: 'resolver',
        depth: 1,
      });
    }

    // DX (main only)
    if (region.isMain && region.dx?.enabled) {
      regionChildren.push({
        id: `${region.id}-dx`,
        kind: 'dx',
        label: 'Direct Connect',
        jsonPath: 'dx',
        regionId: region.id,
        icon: 'dx',
        badge: region.dx.asn ? `ASN ${region.dx.asn}` : undefined,
        depth: 1,
      });
    }

    items.push({
      id: `region-${region.id}`,
      kind: 'region',
      label: region.label,
      jsonPath: region.isMain ? 'vpcs' : region.id,
      regionId: region.id,
      icon: 'region',
      badge: `${Object.keys(region.vpcs).length} VPC`,
      children: regionChildren,
      depth: 0,
    });
  });

  return items;
}

// ============================================
// Icon renderer
// ============================================

function TreeIcon({ type, size = 14 }: { type: TreeItem['icon']; size?: number }) {
  switch (type) {
    case 'region': return <Globe size={size} />;
    case 'vpc': return <Cloud size={size} />;
    case 'tgw': return <Network size={size} />;
    case 'table': return <Layers size={size} />;
    case 'connect': return <Radio size={size} />;
    case 'resolver': return <Server size={size} />;
    case 'dx': return <Cable size={size} />;
    case 'subnet': return <Layers size={size} />;
    case 'component': return <Shield size={size} />;
    case 'peer': return <Link2 size={size} />;
    case 'endpoint': return <Settings size={size} />;
    default: return null;
  }
}

// ============================================
// CIDR validation
// ============================================

function validateCidr(cidr: string): boolean {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) return false;
  const [ip, mask] = cidr.split('/');
  const parts = ip.split('.').map(Number);
  if (parts.some(p => p < 0 || p > 255)) return false;
  const maskNum = parseInt(mask);
  return maskNum >= 8 && maskNum <= 28;
}

// ============================================
// Subnet generator
// ============================================

function generateDefaultSubnets(azCount: number, hasPublic: boolean): number[][][] {
  const subnets: number[][][] = [];
  const internal: number[][] = [];
  for (let i = 0; i < azCount; i++) internal.push([4, i]);
  subnets.push(internal);

  if (hasPublic) {
    const pub: number[][] = [];
    for (let i = 0; i < azCount; i++) pub.push([2, i]);
    subnets.push(pub);
  } else {
    subnets.push([]);
  }

  const priv: number[][] = [];
  for (let i = 0; i < azCount; i++) priv.push([2, azCount + i]);
  subnets.push(priv);
  return subnets;
}

// ============================================
// Deep clone helper
// ============================================

function cloneConfig(config: NetworkConfig): NetworkConfig {
  return JSON.parse(JSON.stringify(config));
}

// ============================================
// Property Editors
// ============================================

function VpcPropertyEditor({ config, regionId, vpcName, vpcConfig, onUpdate, onDelete }: {
  config: NetworkConfig; regionId: string; vpcName: string; vpcConfig: VpcConfig;
  onUpdate: (config: NetworkConfig) => void; onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    cidr: vpcConfig.cidr || '',
    isHub: vpcConfig.is_hub || false,
    isEndpoint: vpcConfig.is_endpoint || false,
    accounts: vpcConfig.accounts?.join(', ') || '',
    enableIgw: vpcConfig.igw?.enabled || false,
    enableNat: vpcConfig.nat?.enabled || false,
    enableNfw: vpcConfig.nfw?.enabled || false,
    enableGwlb: vpcConfig.gwlb?.enabled || false,
    mapPublic: vpcConfig.map_public || false,
    dnsHostnames: vpcConfig.dns?.hostnames ?? true,
    dnsSupport: vpcConfig.dns?.support ?? true,
    enableLog: vpcConfig.log?.enabled || false,
    peers: vpcConfig.peers?.join(', ') || '',
    endpoints: vpcConfig.endpoints?.join(', ') || '',
    gwEndpoints: vpcConfig.gw_endpoints?.join(', ') || '',
  });

  const handleApply = () => {
    if (!validateCidr(form.cidr)) return;
    const newConfig = cloneConfig(config);
    const vpcs = regionId === 'main'
      ? newConfig.vpcs!
      : (newConfig[regionId] as RegionConfig).vpcs;
    const vpc = vpcs[vpcName];

    vpc.cidr = form.cidr;
    vpc.is_hub = form.isHub || undefined;
    vpc.is_endpoint = form.isEndpoint || undefined;
    vpc.accounts = form.accounts.split(',').map(a => a.trim()).filter(Boolean);
    if (vpc.accounts.length === 0) delete (vpc as unknown as Record<string, unknown>).accounts;
    vpc.igw = form.enableIgw ? { enabled: true, ...vpc.igw } : undefined;
    vpc.nat = form.enableNat ? { enabled: true } : undefined;
    vpc.nfw = form.enableNfw ? { enabled: true, ...vpc.nfw } : undefined;
    vpc.gwlb = form.enableGwlb ? { enabled: true, ...vpc.gwlb } : undefined;
    vpc.map_public = form.mapPublic || undefined;
    vpc.dns = { hostnames: form.dnsHostnames, support: form.dnsSupport };
    vpc.log = form.enableLog ? { enabled: true, ...vpc.log } : undefined;
    vpc.peers = form.peers.split(',').map(a => a.trim()).filter(Boolean);
    if (vpc.peers.length === 0) delete (vpc as unknown as Record<string, unknown>).peers;
    vpc.endpoints = form.endpoints.split(',').map(a => a.trim()).filter(Boolean);
    if (vpc.endpoints.length === 0) delete (vpc as unknown as Record<string, unknown>).endpoints;
    vpc.gw_endpoints = form.gwEndpoints.split(',').map(a => a.trim()).filter(Boolean);
    if (vpc.gw_endpoints.length === 0) delete (vpc as unknown as Record<string, unknown>).gw_endpoints;

    onUpdate(newConfig);
  };

  return (
    <div className="rm-property-editor">
      <div className="rm-prop-header">
        <Cloud size={14} />
        <span>{vpcName}</span>
        <button className="rm-delete-btn" onClick={onDelete} title={t('删除 VPC', 'Delete VPC')}><Trash2 size={12} /></button>
      </div>
      <div className="rm-prop-body">
        <div className="form-group">
          <label>CIDR</label>
          <input className="form-input" value={form.cidr}
            onChange={e => setForm(p => ({ ...p, cidr: e.target.value }))} />
        </div>

        <div className="rm-toggle-grid">
          {[
            { key: 'isHub', label: 'Hub VPC' },
            { key: 'isEndpoint', label: 'Endpoint VPC' },
            { key: 'enableIgw', label: 'IGW' },
            { key: 'enableNat', label: 'NAT' },
            { key: 'enableNfw', label: 'NFW' },
            { key: 'enableGwlb', label: 'GWLB' },
            { key: 'mapPublic', label: 'Public IP' },
            { key: 'enableLog', label: 'Flow Log' },
            { key: 'dnsHostnames', label: 'DNS Hostnames' },
            { key: 'dnsSupport', label: 'DNS Support' },
          ].map(({ key, label }) => (
            <label key={key} className="rm-toggle-item">
              <span>{label}</span>
              <button
                className={`rm-toggle-btn ${form[key as keyof typeof form] ? 'on' : ''}`}
                onClick={() => setForm(p => {
                  const val = !p[key as keyof typeof p];
                  const next = { ...p, [key]: val } as typeof p;
                  if (key === 'enableNat' && val) next.enableIgw = true;
                  if (key === 'enableIgw' && !val) next.enableNat = false;
                  return next;
                })}
              >
                {form[key as keyof typeof form] ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              </button>
            </label>
          ))}
        </div>

        <div className="form-group">
          <label>{t('共享账号 (逗号分隔)', 'Shared Accounts (comma separated)')}</label>
          <input className="form-input" value={form.accounts} placeholder="123456789012"
            onChange={e => setForm(p => ({ ...p, accounts: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>{t('VPC Peering (逗号分隔)', 'VPC Peering (comma separated)')}</label>
          <input className="form-input" value={form.peers} placeholder="vpc-a, vpc-b"
            onChange={e => setForm(p => ({ ...p, peers: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>{t('Interface Endpoints (逗号分隔)', 'Interface Endpoints (comma separated)')}</label>
          <input className="form-input" value={form.endpoints} placeholder="ssm, ec2, logs"
            onChange={e => setForm(p => ({ ...p, endpoints: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>{t('Gateway Endpoints (逗号分隔)', 'Gateway Endpoints (comma separated)')}</label>
          <input className="form-input" value={form.gwEndpoints} placeholder="s3, dynamodb"
            onChange={e => setForm(p => ({ ...p, gwEndpoints: e.target.value }))} />
        </div>

        <button className="btn btn-primary rm-apply-btn" onClick={handleApply}>
          <Save size={14} /> {t('应用修改', 'Apply')}
        </button>
      </div>
    </div>
  );
}

function TgwPropertyEditor({ config, regionId, tgw, onUpdate, onDelete }: {
  config: NetworkConfig; regionId: string; tgw: TgwConfig;
  onUpdate: (config: NetworkConfig) => void; onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    asn: tgw.asn?.toString() || '',
    cidr: tgw.cidr || '',
    cidrs: tgw.cidrs?.join(', ') || '',
    name: tgw.name || '',
    description: tgw.description || '',
    peer: tgw.peer || false,
    enableLog: tgw.log?.enabled || false,
  });

  const handleApply = () => {
    const newConfig = cloneConfig(config);
    const target = regionId === 'main' ? newConfig : (newConfig[regionId] as RegionConfig);
    const t = target.tgw!;
    t.asn = form.asn ? parseInt(form.asn) : undefined;
    t.cidr = form.cidr;
    t.cidrs = form.cidrs.split(',').map(s => s.trim()).filter(Boolean);
    if (t.cidrs.length === 0) delete (t as unknown as Record<string, unknown>).cidrs;
    t.name = form.name || undefined;
    t.description = form.description || undefined;
    t.peer = form.peer || undefined;
    t.log = form.enableLog ? { enabled: true, ...t.log } : undefined;
    onUpdate(newConfig);
  };

  return (
    <div className="rm-property-editor">
      <div className="rm-prop-header">
        <Network size={14} />
        <span>Transit Gateway</span>
        <button className="rm-delete-btn" onClick={onDelete} title={t('删除 TGW', 'Delete TGW')}><Trash2 size={12} /></button>
      </div>
      <div className="rm-prop-body">
        <div className="form-group"><label>{t('名称', 'Name')}</label>
          <input className="form-input" value={form.name} placeholder="tgw-main"
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
        <div className="form-group"><label>ASN</label>
          <input className="form-input" value={form.asn} placeholder="64512"
            onChange={e => setForm(p => ({ ...p, asn: e.target.value }))} /></div>
        <div className="form-group"><label>CIDR</label>
          <input className="form-input" value={form.cidr} placeholder="10.100.0.0/24"
            onChange={e => setForm(p => ({ ...p, cidr: e.target.value }))} /></div>
        <div className="form-group"><label>{t('附加 CIDRs (逗号分隔)', 'Additional CIDRs (comma separated)')}</label>
          <input className="form-input" value={form.cidrs}
            onChange={e => setForm(p => ({ ...p, cidrs: e.target.value }))} /></div>
        <div className="form-group"><label>{t('描述', 'Description')}</label>
          <input className="form-input" value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
        <div className="rm-toggle-grid">
          <label className="rm-toggle-item"><span>Peer</span>
            <button className={`rm-toggle-btn ${form.peer ? 'on' : ''}`}
              onClick={() => setForm(p => ({ ...p, peer: !p.peer }))}>
              {form.peer ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
          <label className="rm-toggle-item"><span>Flow Log</span>
            <button className={`rm-toggle-btn ${form.enableLog ? 'on' : ''}`}
              onClick={() => setForm(p => ({ ...p, enableLog: !p.enableLog }))}>
              {form.enableLog ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
        </div>
        <button className="btn btn-primary rm-apply-btn" onClick={handleApply}>
          <Save size={14} /> Apply
        </button>
      </div>
    </div>
  );
}

function TgwTablePropertyEditor({ config, regionId, tableName, table, onUpdate, onDelete }: {
  config: NetworkConfig; regionId: string; tableName: string; table: RouteTableConfig;
  onUpdate: (config: NetworkConfig) => void; onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    associations: table.associations?.join(', ') || '',
    propagations: table.propagations?.join(', ') || '',
    routes: Object.entries(table.routes || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
  });

  const handleApply = () => {
    const newConfig = cloneConfig(config);
    const target = regionId === 'main' ? newConfig : (newConfig[regionId] as RegionConfig);
    const t = target.tgw!.tables![tableName];
    t.associations = form.associations.split(',').map(s => s.trim()).filter(Boolean);
    if (t.associations.length === 0) delete (t as Record<string, unknown>).associations;
    t.propagations = form.propagations.split(',').map(s => s.trim()).filter(Boolean);
    if (t.propagations.length === 0) delete (t as Record<string, unknown>).propagations;
    const routes: Record<string, string> = {};
    form.routes.split('\n').forEach(line => {
      const [k, v] = line.split('=').map(s => s.trim());
      if (k && v) routes[k] = v;
    });
    t.routes = Object.keys(routes).length > 0 ? routes : undefined;
    onUpdate(newConfig);
  };

  return (
    <div className="rm-property-editor">
      <div className="rm-prop-header">
        <Layers size={14} />
        <span>{t('路由表', 'Route Table')}: {tableName}</span>
        <button className="rm-delete-btn" onClick={onDelete}><Trash2 size={12} /></button>
      </div>
      <div className="rm-prop-body">
        <div className="form-group"><label>{t('Associations (逗号分隔)', 'Associations (comma separated)')}</label>
          <input className="form-input" value={form.associations} placeholder="hub, spoke"
            onChange={e => setForm(p => ({ ...p, associations: e.target.value }))} /></div>
        <div className="form-group"><label>{t('Propagations (逗号分隔)', 'Propagations (comma separated)')}</label>
          <input className="form-input" value={form.propagations} placeholder="hub, spoke"
            onChange={e => setForm(p => ({ ...p, propagations: e.target.value }))} /></div>
        <div className="form-group"><label>{t('Routes (每行一条: CIDR=target)', 'Routes (one per line: CIDR=target)')}</label>
          <textarea className="form-input rm-textarea" value={form.routes}
            placeholder="0.0.0.0/0=hub&#10;10.0.0.0/8=propagated"
            onChange={e => setForm(p => ({ ...p, routes: e.target.value }))} /></div>
        <button className="btn btn-primary rm-apply-btn" onClick={handleApply}>
          <Save size={14} /> Apply
        </button>
      </div>
    </div>
  );
}

function ResolverPropertyEditor({ config, resolver, onUpdate, onDelete }: {
  config: NetworkConfig; resolver: ResolverConfig;
  onUpdate: (config: NetworkConfig) => void; onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    inVpc: resolver.in?.vpc || '',
    inGroups: resolver.in?.groups?.join(', ') || '',
    outVpc: resolver.out?.vpc || '',
    outGroups: resolver.out?.groups?.join(', ') || '',
    rules: Object.entries(resolver.rules || {}).map(([name, r]) => `${name}|${r.domain || ''}|${r.ips?.join(',') || ''}|${r.type || 'FORWARD'}|${r.vpcs?.join(',') || ''}`).join('\n'),
  });

  const handleApply = () => {
    const newConfig = cloneConfig(config);
    newConfig.resolver = {
      in: form.inVpc ? { vpc: form.inVpc, groups: form.inGroups.split(',').map(s => s.trim()).filter(Boolean) } : undefined,
      out: form.outVpc ? { vpc: form.outVpc, groups: form.outGroups.split(',').map(s => s.trim()).filter(Boolean) } : undefined,
      rules: (() => {
        const rulesMap: Record<string, { domain?: string; ips?: string[]; type?: string; vpcs?: string[] }> = {};
        form.rules.split('\n').filter(l => l.trim()).forEach(line => {
          const [name, domain, ips, type, vpcs] = line.split('|');
          if (name?.trim()) {
            rulesMap[name.trim()] = {
              domain: domain?.trim(),
              ips: ips?.split(',').map(s => s.trim()).filter(Boolean),
              type: type?.trim() || 'FORWARD',
              vpcs: vpcs?.split(',').map(s => s.trim()).filter(Boolean),
            };
          }
        });
        return Object.keys(rulesMap).length > 0 ? rulesMap : undefined;
      })(),
    };
    if (!newConfig.resolver.rules) delete newConfig.resolver.rules;
    onUpdate(newConfig);
  };

  return (
    <div className="rm-property-editor">
      <div className="rm-prop-header">
        <Server size={14} /><span>Route 53 Resolver</span>
        <button className="rm-delete-btn" onClick={onDelete}><Trash2 size={12} /></button>
      </div>
      <div className="rm-prop-body">
        <div className="form-group"><label>Inbound VPC</label>
          <input className="form-input" value={form.inVpc} onChange={e => setForm(p => ({ ...p, inVpc: e.target.value }))} /></div>
        <div className="form-group"><label>{t('Inbound Groups (逗号分隔)', 'Inbound Groups (comma separated)')}</label>
          <input className="form-input" value={form.inGroups} onChange={e => setForm(p => ({ ...p, inGroups: e.target.value }))} /></div>
        <div className="form-group"><label>Outbound VPC</label>
          <input className="form-input" value={form.outVpc} onChange={e => setForm(p => ({ ...p, outVpc: e.target.value }))} /></div>
        <div className="form-group"><label>{t('Outbound Groups (逗号分隔)', 'Outbound Groups (comma separated)')}</label>
          <input className="form-input" value={form.outGroups} onChange={e => setForm(p => ({ ...p, outGroups: e.target.value }))} /></div>
        <div className="form-group"><label>{t('Rules (每行: name|domain|ips|type|vpcs)', 'Rules (per line: name|domain|ips|type|vpcs)')}</label>
          <textarea className="form-input rm-textarea" value={form.rules}
            placeholder="example.com|10.0.0.2,10.0.1.2|FORWARD|hub,spoke"
            onChange={e => setForm(p => ({ ...p, rules: e.target.value }))} /></div>
        <button className="btn btn-primary rm-apply-btn" onClick={handleApply}>
          <Save size={14} /> Apply
        </button>
      </div>
    </div>
  );
}

function DxPropertyEditor({ config, dx, onUpdate, onDelete }: {
  config: NetworkConfig; dx: DxConfig;
  onUpdate: (config: NetworkConfig) => void; onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    asn: dx.asn?.toString() || '',
    prefixes: dx.prefixes?.join(', ') || '',
  });

  const handleApply = () => {
    const newConfig = cloneConfig(config);
    newConfig.dx = { enabled: true, asn: form.asn ? parseInt(form.asn) : undefined, prefixes: form.prefixes.split(',').map(s => s.trim()).filter(Boolean) };
    onUpdate(newConfig);
  };

  return (
    <div className="rm-property-editor">
      <div className="rm-prop-header">
        <Cable size={14} /><span>Direct Connect</span>
        <button className="rm-delete-btn" onClick={onDelete}><Trash2 size={12} /></button>
      </div>
      <div className="rm-prop-body">
        <div className="form-group"><label>ASN</label>
          <input className="form-input" value={form.asn} placeholder="65001"
            onChange={e => setForm(p => ({ ...p, asn: e.target.value }))} /></div>
        <div className="form-group"><label>{t('Prefixes (逗号分隔)', 'Prefixes (comma separated)')}</label>
          <input className="form-input" value={form.prefixes} placeholder="10.0.0.0/8, 172.16.0.0/12"
            onChange={e => setForm(p => ({ ...p, prefixes: e.target.value }))} /></div>
        <button className="btn btn-primary rm-apply-btn" onClick={handleApply}>
          <Save size={14} /> {t('应用修改', 'Apply')}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Add Resource Forms
// ============================================

type AddFormType = 'vpc' | 'region' | 'tgw' | 'tgw-table' | 'resolver' | 'dx' | null;

function AddResourcePanel({ config, onConfigUpdate, onDone }: {
  config: NetworkConfig; onConfigUpdate: (c: NetworkConfig) => void; onDone: () => void;
}) {
  const { t } = useLanguage();
  const [formType, setFormType] = useState<AddFormType>(null);
  const [error, setError] = useState('');

  // Get regions
  const regions = useMemo(() => {
    const r = ['main'];
    Object.keys(config).forEach(key => {
      if (!ROOT_LEVEL_KEYS.includes(key) && typeof config[key] === 'object' && config[key] !== null && 'vpcs' in (config[key] as object))
        r.push(key);
    });
    return r;
  }, [config]);

  // VPC form
  const [vpcForm, setVpcForm] = useState({ name: '', cidr: '', region: 'main', isHub: false, enableIgw: false, enableNat: false, azCount: 2, accounts: '', peers: '' as string, connectTgwTable: '' });

  // Available VPCs in the selected region for peering
  const vpcRegionPeers = useMemo(() => {
    const r = vpcForm.region;
    if (r === 'main') return Object.keys(config.vpcs || {});
    const rc = config[r] as RegionConfig | undefined;
    return rc?.vpcs ? Object.keys(rc.vpcs) : [];
  }, [config, vpcForm.region]);

  // Available TGW route tables in the selected region
  const vpcRegionTgwTables = useMemo(() => {
    const r = vpcForm.region;
    const tgwRef = r === 'main' ? config.tgw : (config[r] as RegionConfig)?.tgw;
    if (!tgwRef?.enabled || !tgwRef.tables) return [];
    return Object.keys(tgwRef.tables);
  }, [config, vpcForm.region]);

  const hasTgwInRegion = useMemo(() => {
    const r = vpcForm.region;
    const tgwRef = r === 'main' ? config.tgw : (config[r] as RegionConfig)?.tgw;
    return !!tgwRef?.enabled;
  }, [config, vpcForm.region]);

  const handleAddVpc = () => {
    setError('');
    if (!vpcForm.name.trim()) { setError(t('请输入 VPC 名称', 'Enter VPC name')); return; }
    if (!validateCidr(vpcForm.cidr)) { setError(t('CIDR 格式无效', 'Invalid CIDR format')); return; }
    const newConfig = cloneConfig(config);
    const vpcs = vpcForm.region === 'main'
      ? (newConfig.vpcs || (newConfig.vpcs = {}))
      : ((newConfig[vpcForm.region] as RegionConfig || (newConfig[vpcForm.region] = { vpcs: {} })) as RegionConfig).vpcs || ((newConfig[vpcForm.region] as RegionConfig).vpcs = {});
    if (vpcs[vpcForm.name]) { setError(t(`VPC "${vpcForm.name}" 已存在`, `VPC "${vpcForm.name}" already exists`)); return; }
    const vpc: VpcConfig = { cidr: vpcForm.cidr, subnets: generateDefaultSubnets(vpcForm.azCount, vpcForm.enableIgw || vpcForm.enableNat) };
    if (vpcForm.isHub) vpc.is_hub = true;
    if (vpcForm.enableIgw) vpc.igw = { enabled: true };
    if (vpcForm.enableNat) vpc.nat = { enabled: true };
    if (vpcForm.accounts.trim()) vpc.accounts = vpcForm.accounts.split(',').map(a => a.trim()).filter(Boolean);

    // VPC peering
    const peerList = vpcForm.peers.split(',').map(s => s.trim()).filter(Boolean);
    if (peerList.length > 0) {
      vpc.peers = peerList;
      // Also add reverse peering on the target VPCs
      peerList.forEach(peerName => {
        const peerVpcs = vpcForm.region === 'main' ? newConfig.vpcs : (newConfig[vpcForm.region] as RegionConfig)?.vpcs;
        if (peerVpcs?.[peerName]) {
          if (!peerVpcs[peerName].peers) peerVpcs[peerName].peers = [];
          if (!peerVpcs[peerName].peers!.includes(vpcForm.name)) {
            peerVpcs[peerName].peers!.push(vpcForm.name);
          }
        }
      });
    }

    vpcs[vpcForm.name] = vpc;

    // Auto-add VPC to TGW route table propagations if TGW exists
    const regionTarget = vpcForm.region === 'main' ? newConfig : (newConfig[vpcForm.region] as RegionConfig);
    if (regionTarget?.tgw?.enabled && regionTarget.tgw.tables) {
      Object.values(regionTarget.tgw.tables).forEach(table => {
        if (!table.propagations) table.propagations = [];
        if (!table.propagations.includes(vpcForm.name)) {
          table.propagations.push(vpcForm.name);
        }
      });
      // If user selected a specific route table for association, add it
      if (vpcForm.connectTgwTable && regionTarget.tgw.tables[vpcForm.connectTgwTable]) {
        const table = regionTarget.tgw.tables[vpcForm.connectTgwTable];
        if (!table.associations) table.associations = [];
        if (!table.associations.includes(vpcForm.name)) {
          table.associations.push(vpcForm.name);
        }
      }
    }

    onConfigUpdate(newConfig);
    setVpcForm({ name: '', cidr: '', region: 'main', isHub: false, enableIgw: false, enableNat: false, azCount: 2, accounts: '', peers: '', connectTgwTable: '' });
    onDone();
  };

  // Region form
  const [regionForm, setRegionForm] = useState({ id: '' });
  const handleAddRegion = () => {
    setError('');
    const id = regionForm.id.trim().toLowerCase();
    if (!id) { setError(t('请输入区域 ID', 'Enter region ID')); return; }
    if (config[id]) { setError(t(`区域 "${id}" 已存在`, `Region "${id}" already exists`)); return; }
    const newConfig = cloneConfig(config);
    (newConfig as Record<string, unknown>)[id] = { vpcs: {} };
    onConfigUpdate(newConfig);
    setRegionForm({ id: '' });
    onDone();
  };

  // TGW form
  const [tgwForm, setTgwForm] = useState({ region: 'main', asn: '64512', cidr: '' });
  const handleAddTgw = () => {
    setError('');
    if (!tgwForm.cidr) { setError(t('请输入 TGW CIDR', 'Enter TGW CIDR')); return; }
    const newConfig = cloneConfig(config);
    const target = tgwForm.region === 'main' ? newConfig : (newConfig[tgwForm.region] as RegionConfig);
    if (!target) { setError(t('区域不存在', 'Region not found')); return; }
    if (target.tgw?.enabled) { setError(t('该区域已有 TGW', 'TGW already exists in this region')); return; }
    target.tgw = { enabled: true, asn: parseInt(tgwForm.asn) || 64512, cidr: tgwForm.cidr };
    onConfigUpdate(newConfig);
    onDone();
  };

  // TGW Table form
  const [tableForm, setTableForm] = useState({ region: 'main', name: '', associations: '', propagations: '' });

  // Get VPC names for the selected table region (for association/propagation pickers)
  const tableRegionVpcs = useMemo(() => {
    const r = tableForm.region;
    if (r === 'main') return Object.keys(config.vpcs || {});
    const rc = config[r] as RegionConfig | undefined;
    return rc?.vpcs ? Object.keys(rc.vpcs) : [];
  }, [config, tableForm.region]);

  const handleAddTable = () => {
    setError('');
    if (!tableForm.name.trim()) { setError(t('请输入路由表名称', 'Enter route table name')); return; }
    const newConfig = cloneConfig(config);
    const target = tableForm.region === 'main' ? newConfig : (newConfig[tableForm.region] as RegionConfig);
    if (!target?.tgw) { setError(t('该区域没有 TGW', 'No TGW in this region')); return; }
    if (!target.tgw.tables) target.tgw.tables = {};
    if (target.tgw.tables[tableForm.name]) { setError(t('路由表已存在', 'Route table already exists')); return; }
    const assoc = tableForm.associations.split(',').map(s => s.trim()).filter(Boolean);
    const prop = tableForm.propagations.split(',').map(s => s.trim()).filter(Boolean);
    target.tgw.tables[tableForm.name] = {
      ...(assoc.length > 0 ? { associations: assoc } : {}),
      ...(prop.length > 0 ? { propagations: prop } : {}),
    };
    onConfigUpdate(newConfig);
    onDone();
  };

  // Resolver
  const handleAddResolver = () => {
    const newConfig = cloneConfig(config);
    if (newConfig.resolver) { setError(t('Resolver 已存在', 'Resolver already exists')); return; }
    newConfig.resolver = {};
    onConfigUpdate(newConfig);
    onDone();
  };

  // DX
  const [dxForm, setDxForm] = useState({ asn: '65001', prefixes: '' });
  const handleAddDx = () => {
    const newConfig = cloneConfig(config);
    if (newConfig.dx?.enabled) { setError(t('DX 已存在', 'DX already exists')); return; }
    newConfig.dx = { enabled: true, asn: parseInt(dxForm.asn) || 65001, prefixes: dxForm.prefixes.split(',').map(s => s.trim()).filter(Boolean) };
    onConfigUpdate(newConfig);
    onDone();
  };

  // Resource type selector
  const resourceTypes: { type: AddFormType; label: string; icon: React.ReactNode }[] = [
    { type: 'vpc', label: 'VPC', icon: <Cloud size={14} /> },
    { type: 'region', label: t('区域', 'Region'), icon: <Globe size={14} /> },
    { type: 'tgw', label: 'TGW', icon: <Network size={14} /> },
    { type: 'tgw-table', label: t('路由表', 'Route Table'), icon: <Layers size={14} /> },
    { type: 'resolver', label: 'Resolver', icon: <Server size={14} /> },
    { type: 'dx', label: 'Direct Connect', icon: <Cable size={14} /> },
  ];

  if (!formType) {
    return (
      <div className="rm-add-panel">
        <div className="rm-add-grid">
          {resourceTypes.map(({ type, label, icon }) => (
            <button key={type} className="rm-add-type-btn" onClick={() => { setFormType(type); setError(''); }}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rm-add-panel">
      <button className="rm-back-btn" onClick={() => { setFormType(null); setError(''); }}>
        <ChevronLeft size={14} /> {t('返回', 'Back')}
      </button>

      {error && <div className="form-error">{error}</div>}

      {formType === 'vpc' && (
        <div className="rm-form-section">
          <div className="form-group"><label>{t('区域', 'Region')}</label>
            <select className="form-select" value={vpcForm.region} onChange={e => setVpcForm(p => ({ ...p, region: e.target.value }))}>
              {regions.map(r => <option key={r} value={r}>{r === 'main' ? t('主区域', 'Main') : r}</option>)}
            </select></div>
          <div className="form-group"><label>{t('VPC 名称 *', 'VPC Name *')}</label>
            <input className="form-input" value={vpcForm.name} placeholder="prod, dev, test"
              onChange={e => setVpcForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-group"><label>CIDR *</label>
            <input className="form-input" value={vpcForm.cidr} placeholder="10.0.0.0/16"
              onChange={e => setVpcForm(p => ({ ...p, cidr: e.target.value }))} /></div>
          <div className="form-group"><label>{t('可用区数量', 'AZ Count')}</label>
            <select className="form-select" value={vpcForm.azCount} onChange={e => setVpcForm(p => ({ ...p, azCount: parseInt(e.target.value) }))}>
              <option value={2}>2 AZ</option><option value={3}>3 AZ</option>
            </select></div>
          <div className="form-group"><label>{t('共享账号 (逗号分隔)', 'Shared Accounts (comma separated)')}</label>
            <input className="form-input" value={vpcForm.accounts} placeholder="123456789012"
              onChange={e => setVpcForm(p => ({ ...p, accounts: e.target.value }))} /></div>
          <div className="rm-toggle-grid">
            <label className="rm-toggle-item"><span>Hub</span>
              <button className={`rm-toggle-btn ${vpcForm.isHub ? 'on' : ''}`}
                onClick={() => setVpcForm(p => ({ ...p, isHub: !p.isHub }))}>
                {vpcForm.isHub ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
            <label className="rm-toggle-item"><span>IGW</span>
              <button className={`rm-toggle-btn ${vpcForm.enableIgw ? 'on' : ''}`}
                onClick={() => setVpcForm(p => ({ ...p, enableIgw: !p.enableIgw, enableNat: !p.enableIgw ? p.enableNat : false }))}>
                {vpcForm.enableIgw ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
            <label className="rm-toggle-item"><span>NAT</span>
              <button className={`rm-toggle-btn ${vpcForm.enableNat ? 'on' : ''}`}
                onClick={() => setVpcForm(p => ({ ...p, enableNat: !p.enableNat, enableIgw: !p.enableNat ? true : p.enableIgw }))}>
                {vpcForm.enableNat ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button></label>
          </div>

          {/* Connectivity: VPC Peering */}
          {vpcRegionPeers.length > 0 && (
            <div className="form-group"><label>{t('VPC Peering (可选)', 'VPC Peering (optional)')}</label>
              <div className="rm-vpc-chips">
                {vpcRegionPeers.map(v => {
                  const selected = vpcForm.peers.split(',').map(s => s.trim()).filter(Boolean).includes(v);
                  return (
                    <button key={v} className={`rm-vpc-chip ${selected ? 'active' : ''}`}
                      onClick={() => {
                        const cur = vpcForm.peers.split(',').map(s => s.trim()).filter(Boolean);
                        const next = selected ? cur.filter(c => c !== v) : [...cur, v];
                        setVpcForm(p => ({ ...p, peers: next.join(', ') }));
                      }}>{v}</button>
                  );
                })}
              </div></div>
          )}

          {/* Connectivity: TGW Route Table Association */}
          {hasTgwInRegion && (
            <div className="form-group"><label>{t('TGW 路由表关联 (可选)', 'TGW Route Table Association (optional)')}</label>
              {vpcRegionTgwTables.length > 0 ? (
                <select className="form-select" value={vpcForm.connectTgwTable}
                  onChange={e => setVpcForm(p => ({ ...p, connectTgwTable: e.target.value }))}>
                  <option value="">{t('自动 (全部传播)', 'Auto (propagate all)')}</option>
                  {vpcRegionTgwTables.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                </select>
              ) : (
                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{t('TGW 暂无路由表，VPC 将自动添加到传播列表', 'No route tables yet; VPC will be auto-added to propagations')}</span>
              )}
            </div>
          )}

          <button className="btn btn-primary rm-apply-btn" onClick={handleAddVpc}><Plus size={14} /> {t('添加 VPC', 'Add VPC')}</button>
        </div>
      )}

      {formType === 'region' && (
        <div className="rm-form-section">
          <div className="form-group"><label>{t('区域 ID (AWS 区域代码) *', 'Region ID (AWS region code) *')}</label>
            <input className="form-input" value={regionForm.id} placeholder="us-west-1, ap-east-1"
              onChange={e => setRegionForm({ id: e.target.value })} /></div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddRegion}><Plus size={14} /> {t('添加区域', 'Add Region')}</button>
        </div>
      )}

      {formType === 'tgw' && (
        <div className="rm-form-section">
          <div className="form-group"><label>{t('区域', 'Region')}</label>
            <select className="form-select" value={tgwForm.region} onChange={e => setTgwForm(p => ({ ...p, region: e.target.value }))}>
              {regions.map(r => <option key={r} value={r}>{r === 'main' ? t('主区域', 'Main') : r}</option>)}
            </select></div>
          <div className="form-group"><label>ASN</label>
            <input className="form-input" value={tgwForm.asn} onChange={e => setTgwForm(p => ({ ...p, asn: e.target.value }))} /></div>
          <div className="form-group"><label>CIDR *</label>
            <input className="form-input" value={tgwForm.cidr} placeholder="10.100.0.0/24"
              onChange={e => setTgwForm(p => ({ ...p, cidr: e.target.value }))} /></div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddTgw}><Plus size={14} /> {t('添加 TGW', 'Add TGW')}</button>
        </div>
      )}

      {formType === 'tgw-table' && (
        <div className="rm-form-section">
          <div className="form-group"><label>{t('区域', 'Region')}</label>
            <select className="form-select" value={tableForm.region} onChange={e => setTableForm(p => ({ ...p, region: e.target.value }))}>
              {regions.filter(r => { const tgwRef = r === 'main' ? config.tgw : (config[r] as RegionConfig)?.tgw; return tgwRef?.enabled; })
                .map(r => <option key={r} value={r}>{r === 'main' ? t('主区域', 'Main') : r}</option>)}
            </select></div>
          <div className="form-group"><label>{t('路由表名称 *', 'Route Table Name *')}</label>
            <input className="form-input" value={tableForm.name} placeholder="pre, post, spoke"
              onChange={e => setTableForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="form-group"><label>{t('Associations (关联 VPC)', 'Associations (VPCs)')}</label>
            <div className="rm-vpc-chips">
              {tableRegionVpcs.map(v => {
                const selected = tableForm.associations.split(',').map(s => s.trim()).filter(Boolean).includes(v);
                return (
                  <button key={v} className={`rm-vpc-chip ${selected ? 'active' : ''}`}
                    onClick={() => {
                      const cur = tableForm.associations.split(',').map(s => s.trim()).filter(Boolean);
                      const next = selected ? cur.filter(c => c !== v) : [...cur, v];
                      setTableForm(p => ({ ...p, associations: next.join(', ') }));
                    }}>{v}</button>
                );
              })}
            </div></div>
          <div className="form-group"><label>{t('Propagations (路由传播 VPC)', 'Propagations (VPCs)')}</label>
            <div className="rm-vpc-chips">
              {tableRegionVpcs.map(v => {
                const selected = tableForm.propagations.split(',').map(s => s.trim()).filter(Boolean).includes(v);
                return (
                  <button key={v} className={`rm-vpc-chip ${selected ? 'active' : ''}`}
                    onClick={() => {
                      const cur = tableForm.propagations.split(',').map(s => s.trim()).filter(Boolean);
                      const next = selected ? cur.filter(c => c !== v) : [...cur, v];
                      setTableForm(p => ({ ...p, propagations: next.join(', ') }));
                    }}>{v}</button>
                );
              })}
            </div></div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddTable}><Plus size={14} /> {t('添加路由表', 'Add Route Table')}</button>
        </div>
      )}

      {formType === 'resolver' && (
        <div className="rm-form-section">
          <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: 12 }}>{t('将在主区域创建 Route 53 Resolver，创建后可编辑端点和规则。', 'Creates Route 53 Resolver in main region. Configure endpoints and rules after creation.')}</p>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddResolver}><Plus size={14} /> {t('添加 Resolver', 'Add Resolver')}</button>
        </div>
      )}

      {formType === 'dx' && (
        <div className="rm-form-section">
          <div className="form-group"><label>ASN</label>
            <input className="form-input" value={dxForm.asn} onChange={e => setDxForm(p => ({ ...p, asn: e.target.value }))} /></div>
          <div className="form-group"><label>{t('Prefixes (逗号分隔)', 'Prefixes (comma separated)')}</label>
            <input className="form-input" value={dxForm.prefixes} placeholder="10.0.0.0/8"
              onChange={e => setDxForm(p => ({ ...p, prefixes: e.target.value }))} /></div>
          <button className="btn btn-primary rm-apply-btn" onClick={handleAddDx}><Plus size={14} /> {t('添加 DX', 'Add DX')}</button>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main ResourceManager Component
// ============================================

export default function ResourceManager({ config, onConfigUpdate, selectedPath: _selectedPath, onSelectPath, onFocusOverlay, overlayStore, changeLog = [], onHighlightPath, onClearHighlight, diffBaseConfig, diffBaseName, showDiff, onFocusNode }: ResourceManagerProps) {
  void _selectedPath;
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['region-main']));
  const [activeTab, setActiveTab] = useState<'tree' | 'add' | 'overlay' | 'changes' | 'reachability' | 'diff'>('tree');
  const [selectedItem, setSelectedItem] = useState<TreeItem | null>(null);

  const tree = useMemo(() => config ? buildTree(config, t) : [], [config, t]);

  // Compute TGW regions and VPC names for overlay panel
  const tgwRegions = useMemo(() => {
    if (!config) return [];
    const regions: string[] = [];
    if (config.tgw?.enabled) regions.push('main');
    Object.entries(config).forEach(([key, value]) => {
      if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
      if ('vpcs' in value && (value as RegionConfig).tgw?.enabled) regions.push(key);
    });
    return regions;
  }, [config]);

  const vpcNames = useMemo(() => {
    if (!config) return [];
    const result: { regionId: string; name: string }[] = [];
    if (config.vpcs) Object.keys(config.vpcs).forEach(n => result.push({ regionId: 'main', name: n }));
    Object.entries(config).forEach(([key, value]) => {
      if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
      if ('vpcs' in value) {
        Object.keys((value as RegionConfig).vpcs || {}).forEach(n => result.push({ regionId: key, name: n }));
      }
    });
    return result;
  }, [config]);

  const tgwConfigs = useMemo(() => {
    if (!config) return {};
    const result: Record<string, TgwConfig> = {};
    if (config.tgw?.enabled) result['main'] = config.tgw;
    Object.entries(config).forEach(([key, value]) => {
      if (ROOT_LEVEL_KEYS.includes(key) || !value || typeof value !== 'object') return;
      if ('vpcs' in value && (value as RegionConfig).tgw?.enabled) {
        result[key] = (value as RegionConfig).tgw!;
      }
    });
    return result;
  }, [config]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((item: TreeItem) => {
    setSelectedItem(item);
    onSelectPath(item.jsonPath);
  }, [onSelectPath]);

  // Delete handlers
  const handleDeleteVpc = useCallback((regionId: string, vpcName: string) => {
    if (!config || !confirm(t(`确定要删除 VPC "${vpcName}" 吗？`, `Delete VPC "${vpcName}"?`))) return;
    const newConfig = cloneConfig(config);
    if (regionId === 'main') { delete newConfig.vpcs![vpcName]; }
    else { delete (newConfig[regionId] as RegionConfig).vpcs[vpcName]; }
    onConfigUpdate(newConfig);
    setSelectedItem(null);
  }, [config, onConfigUpdate]);

  const handleDeleteTgw = useCallback((regionId: string) => {
    if (!config || !confirm(t('确定要删除 TGW 吗？', 'Delete TGW?'))) return;
    const newConfig = cloneConfig(config);
    if (regionId === 'main') { delete newConfig.tgw; }
    else { delete (newConfig[regionId] as RegionConfig).tgw; }
    onConfigUpdate(newConfig);
    setSelectedItem(null);
  }, [config, onConfigUpdate]);

  const handleDeleteTgwTable = useCallback((regionId: string, tableName: string) => {
    if (!config || !confirm(t(`确定要删除路由表 "${tableName}" 吗？`, `Delete route table "${tableName}"?`))) return;
    const newConfig = cloneConfig(config);
    const tgw = regionId === 'main' ? newConfig.tgw : (newConfig[regionId] as RegionConfig).tgw;
    if (tgw?.tables) delete tgw.tables[tableName];
    onConfigUpdate(newConfig);
    setSelectedItem(null);
  }, [config, onConfigUpdate]);

  const handleDeleteResolver = useCallback(() => {
    if (!config || !confirm(t('确定要删除 Resolver 吗？', 'Delete Resolver?'))) return;
    const newConfig = cloneConfig(config);
    delete newConfig.resolver;
    onConfigUpdate(newConfig);
    setSelectedItem(null);
  }, [config, onConfigUpdate]);

  const handleDeleteDx = useCallback(() => {
    if (!config || !confirm(t('确定要删除 Direct Connect 吗？', 'Delete Direct Connect?'))) return;
    const newConfig = cloneConfig(config);
    delete newConfig.dx;
    onConfigUpdate(newConfig);
    setSelectedItem(null);
  }, [config, onConfigUpdate]);

  const handleDeleteRegion = useCallback((regionId: string) => {
    if (!config || regionId === 'main' || !confirm(t(`确定要删除区域 "${regionId}" 吗？`, `Delete region "${regionId}"?`))) return;
    const newConfig = cloneConfig(config);
    delete (newConfig as Record<string, unknown>)[regionId];
    onConfigUpdate(newConfig);
    setSelectedItem(null);
  }, [config, onConfigUpdate]);

  // Render property editor for selected item
  const renderPropertyEditor = () => {
    if (!selectedItem || !config) return null;
    const { kind, regionId, jsonPath } = selectedItem;

    if (kind === 'vpc') {
      const vpcName = jsonPath.split('.').pop()!;
      const vpcs = regionId === 'main' ? config.vpcs : (config[regionId] as RegionConfig)?.vpcs;
      const vpc = vpcs?.[vpcName];
      if (!vpc) return null;
      return <VpcPropertyEditor key={jsonPath} config={config} regionId={regionId} vpcName={vpcName} vpcConfig={vpc}
        onUpdate={onConfigUpdate} onDelete={() => handleDeleteVpc(regionId, vpcName)} />;
    }
    if (kind === 'tgw') {
      const tgw = regionId === 'main' ? config.tgw : (config[regionId] as RegionConfig)?.tgw;
      if (!tgw) return null;
      return <TgwPropertyEditor key={jsonPath} config={config} regionId={regionId} tgw={tgw}
        onUpdate={onConfigUpdate} onDelete={() => handleDeleteTgw(regionId)} />;
    }
    if (kind === 'tgw-table') {
      const tableName = jsonPath.split('.').pop()!;
      const tgw = regionId === 'main' ? config.tgw : (config[regionId] as RegionConfig)?.tgw;
      const table = tgw?.tables?.[tableName];
      if (!table) return null;
      return <TgwTablePropertyEditor key={jsonPath} config={config} regionId={regionId} tableName={tableName} table={table}
        onUpdate={onConfigUpdate} onDelete={() => handleDeleteTgwTable(regionId, tableName)} />;
    }
    if (kind === 'resolver') {
      return <ResolverPropertyEditor key={jsonPath} config={config} resolver={config.resolver!}
        onUpdate={onConfigUpdate} onDelete={handleDeleteResolver} />;
    }
    if (kind === 'dx') {
      return <DxPropertyEditor key={jsonPath} config={config} dx={config.dx!}
        onUpdate={onConfigUpdate} onDelete={handleDeleteDx} />;
    }
    if (kind === 'subnet-type') {
      // Extract VPC name from jsonPath like "vpcs.hub.subnets" or "us-west-1.vpcs.hub.subnets"
      const parts = jsonPath.split('.');
      const vpcsIdx = parts.indexOf('vpcs');
      const vpcName = vpcsIdx >= 0 ? parts[vpcsIdx + 1] : '';
      const vpcs = regionId === 'main' ? config.vpcs : (config[regionId] as RegionConfig)?.vpcs;
      const vpc = vpcs?.[vpcName];
      if (!vpc) return null;
      return (
        <div className="rm-property-editor">
          <SubnetEditor
            key={jsonPath}
            vpcConfig={vpc}
            onSave={(subnets: SubnetsConfig) => {
              const newConfig = cloneConfig(config);
              const targetVpcs = regionId === 'main' ? newConfig.vpcs! : (newConfig[regionId] as RegionConfig).vpcs;
              targetVpcs[vpcName].subnets = subnets;
              // Remove legacy subnet_names when switching to map format
              delete (targetVpcs[vpcName] as unknown as Record<string, unknown>).subnet_names;
              onConfigUpdate(newConfig);
            }}
          />
        </div>
      );
    }
    if (kind === 'region' && regionId !== 'main') {
      return (
        <div className="rm-property-editor">
          <div className="rm-prop-header">
            <Globe size={14} /><span>{regionId}</span>
            <button className="rm-delete-btn" onClick={() => handleDeleteRegion(regionId)}><Trash2 size={12} /></button>
          </div>
          <div className="rm-prop-body">
            <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{t('对等区域。可通过资源树管理其 VPC 和 TGW。', 'Peer region. Manage its VPCs and TGW from the resource tree.')}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  // Render tree item
  const renderTreeItem = (item: TreeItem) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expanded.has(item.id);
    const isSelected = selectedItem?.id === item.id;

    return (
      <div key={item.id}>
        <div
          className={`rm-tree-item ${isSelected ? 'selected' : ''} depth-${item.depth}`}
          onClick={() => handleSelect(item)}
        >
          {hasChildren ? (
            <button className="rm-expand-btn" onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}>
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="rm-expand-placeholder" />
          )}
          <span className={`rm-tree-icon icon-${item.icon}`}><TreeIcon type={item.icon} size={13} /></span>
          <span className="rm-tree-label">{item.label}</span>
          {item.badge && <span className="rm-tree-badge">{item.badge}</span>}
        </div>
        {hasChildren && isExpanded && (
          <div className="rm-tree-children">
            {item.children!.map(child => renderTreeItem(child))}
          </div>
        )}
      </div>
    );
  };

  if (!config) return null;

  return (
    <>
      <button className={`panel-toggle ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? <ChevronRightIcon size={16} /> : <ChevronLeft size={16} />}
        {!isOpen && <span className="toggle-label">{t('资源', 'Res')}</span>}
      </button>

      <div className={`side-panel rm-panel ${isOpen ? 'open' : ''}`}>
        {/* Tabs */}
        <div className="rm-tabs">
          <button className={`rm-tab ${activeTab === 'tree' ? 'active' : ''}`} onClick={() => setActiveTab('tree')}>
            <FolderTree size={14} /> {t('资源树', 'Tree')}
          </button>
          <button className={`rm-tab ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>
            <Plus size={14} /> {t('新建', 'New')}
          </button>
          <button className={`rm-tab ${activeTab === 'overlay' ? 'active' : ''}`} onClick={() => setActiveTab('overlay')}>
            <Wifi size={14} /> {t('扩展', 'Overlay')}
            {overlayStore.resources.length > 0 && <span className="rm-tab-badge">{overlayStore.resources.length}</span>}
          </button>
          <button className={`rm-tab ${activeTab === 'changes' ? 'active' : ''}`} onClick={() => setActiveTab('changes')}>
            <GitCommit size={14} /> {t('变更', 'Changes')}
            {changeLog.length > 0 && <span className="rm-tab-badge">{changeLog.length}</span>}
          </button>
          <button className={`rm-tab ${activeTab === 'reachability' ? 'active' : ''}`} onClick={() => setActiveTab('reachability')}>
            <Waypoints size={14} /> {t('可达性', 'Reach')}
          </button>
          {showDiff && diffBaseConfig && (
            <button className={`rm-tab ${activeTab === 'diff' ? 'active' : ''}`} onClick={() => setActiveTab('diff')}>
              <GitCompareArrows size={14} /> {t('对比', 'Diff')}
            </button>
          )}
        </div>

        <div className="rm-body">
          {activeTab === 'tree' && (
            <>
              <div className="rm-tree-container">
                {tree.map(item => renderTreeItem(item))}
              </div>
              <div className="rm-property-container">
                {renderPropertyEditor()}
              </div>
            </>
          )}
          {activeTab === 'add' && (
            <AddResourcePanel config={config} onConfigUpdate={onConfigUpdate} onDone={() => setActiveTab('tree')} />
          )}
          {activeTab === 'overlay' && (
            <OverlayPanel store={overlayStore} tgwRegions={tgwRegions} vpcNames={vpcNames} tgwConfigs={tgwConfigs} config={config} onConfigUpdate={onConfigUpdate} onFocusOverlay={onFocusOverlay} />
          )}
          {activeTab === 'reachability' && (
            <ReachabilityPanel
              config={config}
              onHighlightPath={onHighlightPath || (() => {})}
              onClearHighlight={onClearHighlight || (() => {})}
            />
          )}
          {activeTab === 'diff' && diffBaseConfig && (
            <DiffPanel
              currentConfig={config}
              baseConfig={diffBaseConfig}
              baseName={diffBaseName}
              onFocusNode={onFocusNode}
            />
          )}
          {activeTab === 'changes' && (() => {
            const jsonChanges = changeLog.filter(e => e.source === 'json');
            const overlayChanges = changeLog.filter(e => e.source === 'overlay');
            return (
              <div className="rm-changes-panel">
                {changeLog.length === 0 ? (
                  <div className="rm-changes-empty">{t('暂无变更', 'No changes yet')}</div>
                ) : (<>
                  {jsonChanges.length > 0 && (
                    <div className="rm-changes-section">
                      <div className="rm-changes-section-title">{t('JSON 配置变更', 'JSON Config Changes')}</div>
                      <div className="rm-changes-list">
                        {jsonChanges.map((entry, i) => (
                          <div key={`j-${i}`} className={`rm-change-item rm-change-${entry.type}`}
                            onClick={() => onSelectPath(entry.jsonPath)}>
                            <span className="rm-change-icon">
                              {entry.type === 'added' ? <PlusCircle size={13} /> : entry.type === 'removed' ? <MinusCircle size={13} /> : <Edit3 size={13} />}
                            </span>
                            <span className="rm-change-kind">{entry.kind}</span>
                            <span className="rm-change-name">{entry.name}</span>
                            <span className="rm-change-type-badge">{entry.type === 'added' ? t('新增', 'Added') : entry.type === 'removed' ? t('删除', 'Removed') : t('修改', 'Modified')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {overlayChanges.length > 0 && (
                    <div className="rm-changes-section">
                      <div className="rm-changes-section-title">{t('手动 / 扩展操作', 'Manual / Overlay Operations')}</div>
                      <div className="rm-changes-list">
                        {overlayChanges.map((entry, i) => (
                          <div key={`o-${i}`} className={`rm-change-item rm-change-${entry.type} rm-change-overlay`}
                            onClick={() => onSelectPath(entry.jsonPath)}>
                            <span className="rm-change-icon">
                              {entry.type === 'added' ? <PlusCircle size={13} /> : entry.type === 'removed' ? <MinusCircle size={13} /> : <Edit3 size={13} />}
                            </span>
                            <span className="rm-change-kind">{entry.kind}</span>
                            <span className="rm-change-name">{entry.name}</span>
                            <span className="rm-change-type-badge rm-change-overlay-badge">{t('手动', 'Manual')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>)}
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}
