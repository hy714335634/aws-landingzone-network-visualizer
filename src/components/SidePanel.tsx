import { useState, useCallback } from 'react';
import { 
  ChevronLeft, ChevronRight, Plus, Cloud, Trash2, 
  Save, RotateCcw, Server
} from 'lucide-react';
import type { NetworkConfig, VpcConfig } from '../types/network';

interface SidePanelProps {
  config: NetworkConfig | null;
  onConfigUpdate: (config: NetworkConfig) => void;
}

interface NewVpcForm {
  name: string;
  cidr: string;
  region: string;
  isHub: boolean;
  accounts: string;
  enableNat: boolean;
  enableIgw: boolean;
  azCount: number;
}

const DEFAULT_VPC_FORM: NewVpcForm = {
  name: '',
  cidr: '',
  region: 'main',
  isHub: false,
  accounts: '',
  enableNat: false,
  enableIgw: false,
  azCount: 2,
};

// 生成默认子网配置
function generateDefaultSubnets(azCount: number, hasPublic: boolean): number[][][] {
  const subnets: number[][][] = [];
  
  // Internal subnets (for TGW)
  const internal: number[][] = [];
  for (let i = 0; i < azCount; i++) {
    internal.push([4, i]);
  }
  subnets.push(internal);
  
  // Public subnets (if IGW/NAT enabled)
  if (hasPublic) {
    const publicSubnets: number[][] = [];
    for (let i = 0; i < azCount; i++) {
      publicSubnets.push([2, i]);
    }
    subnets.push(publicSubnets);
  } else {
    subnets.push([]);
  }
  
  // Private subnet 1
  const private1: number[][] = [];
  for (let i = 0; i < azCount; i++) {
    private1.push([2, azCount + i]);
  }
  subnets.push(private1);
  
  return subnets;
}

export default function SidePanel({ config, onConfigUpdate }: SidePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [vpcForm, setVpcForm] = useState<NewVpcForm>(DEFAULT_VPC_FORM);
  const [error, setError] = useState<string>('');

  // 获取所有区域
  const getRegions = useCallback(() => {
    if (!config) return ['main'];
    const regions = ['main'];
    Object.keys(config).forEach(key => {
      if (key !== 'vpcs' && key !== 'tgw' && key !== 'resolver' && key !== 'dx' && key !== 'variables' &&
          typeof config[key] === 'object' && config[key] !== null &&
          'vpcs' in (config[key] as object)) {
        regions.push(key);
      }
    });
    return regions;
  }, [config]);

  // 获取指定区域的 VPC 列表
  const getVpcsInRegion = useCallback((region: string) => {
    if (!config) return [];
    if (region === 'main') {
      return config.vpcs ? Object.keys(config.vpcs) : [];
    }
    const regionConfig = config[region] as { vpcs?: Record<string, VpcConfig> } | undefined;
    return regionConfig?.vpcs ? Object.keys(regionConfig.vpcs) : [];
  }, [config]);

  // 验证 CIDR 格式
  const validateCidr = (cidr: string): boolean => {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    if (!cidrRegex.test(cidr)) return false;
    const [ip, mask] = cidr.split('/');
    const parts = ip.split('.').map(Number);
    if (parts.some(p => p < 0 || p > 255)) return false;
    const maskNum = parseInt(mask);
    return maskNum >= 8 && maskNum <= 28;
  };

  // 添加新 VPC
  const handleAddVpc = useCallback(() => {
    setError('');
    
    if (!vpcForm.name.trim()) {
      setError('请输入 VPC 名称');
      return;
    }
    
    if (!validateCidr(vpcForm.cidr)) {
      setError('CIDR 格式无效 (例如: 10.0.0.0/16)');
      return;
    }

    // 检查名称是否已存在
    const existingVpcs = getVpcsInRegion(vpcForm.region);
    if (existingVpcs.includes(vpcForm.name)) {
      setError(`VPC "${vpcForm.name}" 在该区域已存在`);
      return;
    }

    if (!config) return;

    // 创建新 VPC 配置
    const newVpc: VpcConfig = {
      cidr: vpcForm.cidr,
      subnets: generateDefaultSubnets(vpcForm.azCount, vpcForm.enableIgw || vpcForm.enableNat),
    };

    if (vpcForm.isHub) {
      newVpc.is_hub = true;
    }

    if (vpcForm.accounts.trim()) {
      newVpc.accounts = vpcForm.accounts.split(',').map(a => a.trim()).filter(a => a);
    }

    if (vpcForm.enableNat) {
      newVpc.nat = { enabled: true };
    }

    if (vpcForm.enableIgw) {
      newVpc.igw = { enabled: true };
    }

    // 更新配置
    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    
    if (vpcForm.region === 'main') {
      if (!newConfig.vpcs) newConfig.vpcs = {};
      newConfig.vpcs[vpcForm.name] = newVpc;
    } else {
      if (!newConfig[vpcForm.region]) {
        newConfig[vpcForm.region] = { vpcs: {} };
      }
      const regionConfig = newConfig[vpcForm.region] as { vpcs: Record<string, VpcConfig> };
      if (!regionConfig.vpcs) regionConfig.vpcs = {};
      regionConfig.vpcs[vpcForm.name] = newVpc;
    }

    onConfigUpdate(newConfig);
    setVpcForm(DEFAULT_VPC_FORM);
  }, [config, vpcForm, getVpcsInRegion, onConfigUpdate]);

  // 删除 VPC
  const handleDeleteVpc = useCallback((region: string, vpcName: string) => {
    if (!config) return;
    if (!confirm(`确定要删除 VPC "${vpcName}" 吗？`)) return;

    const newConfig = JSON.parse(JSON.stringify(config)) as NetworkConfig;
    
    if (region === 'main') {
      if (newConfig.vpcs) {
        delete newConfig.vpcs[vpcName];
      }
    } else {
      const regionConfig = newConfig[region] as { vpcs?: Record<string, VpcConfig> } | undefined;
      if (regionConfig?.vpcs) {
        delete regionConfig.vpcs[vpcName];
      }
    }

    onConfigUpdate(newConfig);
  }, [config, onConfigUpdate]);

  // 重置表单
  const handleReset = () => {
    setVpcForm(DEFAULT_VPC_FORM);
    setError('');
  };

  // 下载配置
  const handleDownload = useCallback(() => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'network-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  if (!config) return null;

  const regions = getRegions();

  return (
    <>
      <button 
        className={`panel-toggle ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        {!isOpen && <span className="toggle-label">组件</span>}
      </button>

      <div className={`side-panel ${isOpen ? 'open' : ''}`}>
        <div className="panel-header">
          <Plus size={18} />
          <span>添加组件</span>
          <button className="header-btn" onClick={handleDownload} title="保存配置">
            <Save size={14} />
          </button>
        </div>

        <div className="panel-content">
          {/* 添加 VPC 表单 */}
          <div className="panel-section">
            <div className="section-title">
              <Cloud size={14} />
              <span>新建 VPC</span>
            </div>
            
            <div className="form-group">
              <label>区域</label>
              <select 
                value={vpcForm.region}
                onChange={(e) => setVpcForm(prev => ({ ...prev, region: e.target.value }))}
                className="form-select"
              >
                {regions.map(r => (
                  <option key={r} value={r}>
                    {r === 'main' ? '主区域' : r}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>VPC 名称 *</label>
              <input
                type="text"
                value={vpcForm.name}
                onChange={(e) => setVpcForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="例如: prod, dev, test"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>CIDR *</label>
              <input
                type="text"
                value={vpcForm.cidr}
                onChange={(e) => setVpcForm(prev => ({ ...prev, cidr: e.target.value }))}
                placeholder="例如: 10.0.0.0/16"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>可用区数量</label>
              <select 
                value={vpcForm.azCount}
                onChange={(e) => setVpcForm(prev => ({ ...prev, azCount: parseInt(e.target.value) }))}
                className="form-select"
              >
                <option value={2}>2 个可用区</option>
                <option value={3}>3 个可用区</option>
              </select>
            </div>

            <div className="form-group">
              <label>共享账号 ID (逗号分隔)</label>
              <input
                type="text"
                value={vpcForm.accounts}
                onChange={(e) => setVpcForm(prev => ({ ...prev, accounts: e.target.value }))}
                placeholder="例如: 123456789012"
                className="form-input"
              />
            </div>

            <div className="form-checkboxes">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={vpcForm.isHub}
                  onChange={(e) => setVpcForm(prev => ({ ...prev, isHub: e.target.checked }))}
                />
                <span>Hub VPC</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={vpcForm.enableIgw}
                  onChange={(e) => setVpcForm(prev => ({ 
                    ...prev, 
                    enableIgw: e.target.checked,
                    enableNat: e.target.checked ? prev.enableNat : false 
                  }))}
                />
                <span>启用 IGW</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={vpcForm.enableNat}
                  onChange={(e) => setVpcForm(prev => ({ 
                    ...prev, 
                    enableNat: e.target.checked,
                    enableIgw: e.target.checked ? true : prev.enableIgw
                  }))}
                />
                <span>启用 NAT</span>
              </label>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={handleReset}>
                <RotateCcw size={14} />
                重置
              </button>
              <button className="btn btn-primary" onClick={handleAddVpc}>
                <Plus size={14} />
                添加 VPC
              </button>
            </div>
          </div>

          {/* 现有 VPC 列表 */}
          <div className="panel-section">
            <div className="section-title">
              <Server size={14} />
              <span>现有 VPC</span>
            </div>
            
            {regions.map(region => {
              const vpcs = getVpcsInRegion(region);
              if (vpcs.length === 0) return null;
              
              return (
                <div key={region} className="vpc-region-group">
                  <div className="region-label">
                    {region === 'main' ? '主区域' : region}
                  </div>
                  {vpcs.map(vpcName => (
                    <div key={vpcName} className="vpc-item">
                      <Cloud size={14} />
                      <span className="vpc-name">{vpcName}</span>
                      <button 
                        className="delete-btn"
                        onClick={() => handleDeleteVpc(region, vpcName)}
                        title="删除 VPC"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
