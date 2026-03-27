import { useState, useMemo } from 'react';
import { Plus, Trash2, Save, Layers, AlertCircle } from 'lucide-react';
import type { VpcConfig, SubnetMapEntry, SubnetsConfig } from '../types/network';
import { useLanguage } from '../i18n/LanguageContext';

interface SubnetEditorProps {
  vpcConfig: VpcConfig;
  onSave: (subnets: SubnetsConfig, subnetNames?: string[]) => void;
}

interface SubnetRow {
  name: string;
  cidrs: number[][];
  tags: Record<string, string>;
  isReserved: boolean;
}

function calculateSubnetCidr(vpcCidr: string, subnetDef: number[]): string {
  const [offset, index] = subnetDef;
  const [baseIp, vpcMaskStr] = vpcCidr.split('/');
  const vpcMask = parseInt(vpcMaskStr);
  const subnetMask = vpcMask + offset;
  const subnetSize = Math.pow(2, 32 - subnetMask);
  const ipParts = baseIp.split('.').map(Number);
  const baseIpNum = (ipParts[0] << 24) >>> 0 | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const subnetIpNum = (baseIpNum + (index * subnetSize)) >>> 0;
  const newIp = [(subnetIpNum >>> 24) & 255, (subnetIpNum >>> 16) & 255, (subnetIpNum >>> 8) & 255, subnetIpNum & 255].join('.');
  return `${newIp}/${subnetMask}`;
}

function ipCount(cidr: string): number {
  const mask = parseInt(cidr.split('/')[1]);
  return Math.max(0, Math.pow(2, 32 - mask) - 5);
}

function normalizeToRows(subnets: SubnetsConfig, subnetNames?: string[]): SubnetRow[] {
  const RESERVED_NAMES = ['intra', 'public', 'private'];
  if (Array.isArray(subnets)) {
    const legacyTypes = ['intra', 'public', 'private'];
    return subnets.map((cidrs, index) => {
      const name = subnetNames?.[index] ?? (index < legacyTypes.length ? legacyTypes[index] : `private-${index - 2}`);
      return { name, cidrs: cidrs || [], tags: {}, isReserved: RESERVED_NAMES.includes(name) };
    }).filter(r => r.cidrs.length > 0);
  }
  return Object.entries(subnets).map(([name, entry]) => ({
    name, cidrs: (entry as SubnetMapEntry).cidrs || [], tags: (entry as SubnetMapEntry).tags || {},
    isReserved: RESERVED_NAMES.includes(name),
  }));
}

function rowsToMapFormat(rows: SubnetRow[]): Record<string, SubnetMapEntry> {
  const result: Record<string, SubnetMapEntry> = {};
  rows.forEach(row => {
    if (row.cidrs.length > 0) {
      result[row.name] = { cidrs: row.cidrs, ...(Object.keys(row.tags).length > 0 ? { tags: row.tags } : {}) };
    }
  });
  return result;
}

function subnetColor(name: string): string {
  if (name === 'intra') return '#f59e0b';
  if (name === 'public') return '#22c55e';
  if (name.startsWith('private') || name === 'private') return '#3b82f6';
  if (name === 'gwlb') return '#ef4444';
  return '#8b5cf6';
}

export default function SubnetEditor({ vpcConfig, onSave }: SubnetEditorProps) {
  const { t } = useLanguage();
  const initialRows = useMemo(() => normalizeToRows(vpcConfig.subnets, vpcConfig.subnet_names), [vpcConfig.subnets, vpcConfig.subnet_names]);
  const [rows, setRows] = useState<SubnetRow[]>(initialRows);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const vpcCidr = vpcConfig.cidr;
  const vpcMask = parseInt(vpcCidr.split('/')[1] || '16');
  const azCount = rows.length > 0 ? Math.max(...rows.map(r => r.cidrs.length)) : (vpcConfig.az_count || 2);

  const handleAddType = () => {
    setError('');
    const name = newName.trim().toLowerCase();
    if (!name) { setError(t('请输入子网名称', 'Enter subnet name')); return; }
    if (rows.some(r => r.name === name)) { setError(t('子网名称已存在', 'Subnet name already exists')); return; }
    const defaultNewbits = Math.min(4, 28 - vpcMask);
    const maxNetnum = Math.max(0, ...rows.flatMap(r => r.cidrs.map(c => c[1])));
    const cidrs: number[][] = [];
    for (let i = 0; i < azCount; i++) cidrs.push([defaultNewbits, maxNetnum + 1 + i]);
    setRows([...rows, { name, cidrs, tags: {}, isReserved: false }]);
    setNewName('');
  };

  const handleRemoveType = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const handleCidrUpdate = (rowIndex: number, azIndex: number, field: 'newbits' | 'netnum', value: number) => {
    setRows(prev => prev.map((row, ri) => {
      if (ri !== rowIndex) return row;
      const newCidrs = row.cidrs.map((cidr, ai) => {
        if (ai !== azIndex) return cidr;
        return field === 'newbits' ? [value, cidr[1]] : [cidr[0], value];
      });
      return { ...row, cidrs: newCidrs };
    }));
  };

  const handleBatchNewbits = (rowIndex: number, newbits: number) => {
    setRows(prev => prev.map((row, ri) => {
      if (ri !== rowIndex) return row;
      return { ...row, cidrs: row.cidrs.map(cidr => [newbits, cidr[1]]) };
    }));
  };

  const handleAddAz = () => {
    setRows(prev => prev.map(row => {
      const maxNetnum = Math.max(0, ...row.cidrs.map(c => c[1]));
      return { ...row, cidrs: [...row.cidrs, [row.cidrs[0]?.[0] || 4, maxNetnum + 1]] };
    }));
  };

  const handleRemoveAz = () => {
    if (azCount <= 1) return;
    setRows(prev => prev.map(row => ({ ...row, cidrs: row.cidrs.slice(0, -1) })));
  };

  const handleSave = () => {
    onSave(rowsToMapFormat(rows));
  };

  const allCidrs = rows.flatMap(row => row.cidrs.map(c => {
    try { return calculateSubnetCidr(vpcCidr, c); } catch { return null; }
  })).filter(Boolean) as string[];
  const hasDuplicates = new Set(allCidrs).size !== allCidrs.length;

  const RESERVED_LABELS: Record<string, [string, string]> = {
    intra: ['内部', 'Internal'],
    public: ['公有', 'Public'],
    private: ['私有', 'Private'],
  };

  return (
    <div className="subnet-editor">
      <div className="se-header">
        <Layers size={14} />
        <span>{t('子网编辑器', 'Subnet Editor')}</span>
        <span className="se-vpc-cidr">{vpcCidr}</span>
      </div>

      <div className="se-az-bar">
        <span className="se-az-label">{azCount} {t('可用区', 'AZ')}</span>
        <button className="se-az-btn" onClick={handleAddAz} title={t('添加 AZ', 'Add AZ')}>+</button>
        <button className="se-az-btn" onClick={handleRemoveAz} title={t('移除 AZ', 'Remove AZ')} disabled={azCount <= 1}>-</button>
      </div>

      <div className="se-grid">
        <div className="se-grid-header">
          <div className="se-cell-name">{t('类型', 'Type')}</div>
          <div className="se-cell-bits">Bits</div>
          {Array.from({ length: azCount }, (_, i) => (
            <div key={i} className="se-cell-az">AZ-{String.fromCharCode(97 + i).toUpperCase()}</div>
          ))}
        </div>

        {rows.map((row, rowIndex) => (
          <div key={row.name} className="se-grid-row">
            <div className="se-cell-name">
              <span className="se-type-dot" style={{ background: subnetColor(row.name) }} />
              <span className="se-type-name">{row.name}</span>
              {row.isReserved && RESERVED_LABELS[row.name] && (
                <span className="se-type-reserved">{t(RESERVED_LABELS[row.name][0], RESERVED_LABELS[row.name][1])}</span>
              )}
              {!row.isReserved && (
                <button className="se-remove-btn" onClick={() => handleRemoveType(rowIndex)}><Trash2 size={10} /></button>
              )}
            </div>
            <div className="se-cell-bits">
              <select className="se-bits-select" value={row.cidrs[0]?.[0] || 4}
                onChange={e => handleBatchNewbits(rowIndex, parseInt(e.target.value))}>
                {Array.from({ length: 28 - vpcMask }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>/{vpcMask + n}</option>
                ))}
              </select>
            </div>
            {row.cidrs.map((cidr, azIndex) => {
              let cidrStr = '—';
              let ips = 0;
              try {
                cidrStr = calculateSubnetCidr(vpcCidr, cidr);
                ips = ipCount(cidrStr);
              } catch { /* skip */ }
              return (
                <div key={azIndex} className="se-cell-az">
                  <div className="se-cidr-display" style={{ borderColor: subnetColor(row.name) }}>
                    <span className="se-cidr-addr">{cidrStr.split('/')[0]}</span>
                    <span className="se-cidr-mask">/{cidrStr.split('/')[1]}</span>
                  </div>
                  <div className="se-cidr-meta">
                    <span className="se-ip-count">{ips} IPs</span>
                    <input className="se-netnum-input" type="number" min={0} value={cidr[1]}
                      onChange={e => handleCidrUpdate(rowIndex, azIndex, 'netnum', parseInt(e.target.value) || 0)}
                      title="Network number" />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {hasDuplicates && (
        <div className="se-warning">
          <AlertCircle size={12} /> {t('CIDR 存在重叠', 'CIDR overlap detected')}
        </div>
      )}

      <div className="se-add-row">
        <input className="form-input se-add-input" value={newName} placeholder={t('新子网类型名称', 'New subnet type name')}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddType()} />
        <button className="btn btn-secondary se-add-btn" onClick={handleAddType}>
          <Plus size={12} /> {t('添加', 'Add')}
        </button>
      </div>
      {error && <div className="form-error" style={{ marginTop: 6 }}>{error}</div>}

      <button className="btn btn-primary rm-apply-btn" onClick={handleSave}>
        <Save size={14} /> {t('保存子网配置', 'Save Subnets')}
      </button>
    </div>
  );
}
