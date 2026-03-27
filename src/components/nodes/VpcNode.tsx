import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Cloud, Globe, ArrowUpDown, Shield, Server } from 'lucide-react';

interface VpcNodeData {
  label: string;
  cidr: string;
  isHub?: boolean;
  isEndpoint?: boolean;
  accounts?: string[];
  hasIgw?: boolean;
  hasNat?: boolean;
  hasNfw?: boolean;
  hasGwlb?: boolean;
}

const VpcNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as VpcNodeData;
  const hasComponents = nodeData.hasIgw || nodeData.hasNfw || nodeData.hasGwlb;

  return (
    <div className={`vpc-node ${nodeData.isHub ? 'vpc-hub' : ''} ${nodeData.isEndpoint ? 'vpc-endpoint' : ''}`}>
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <div className="vpc-header">
        <div className="vpc-title">
          <Cloud size={16} />
          <span className="vpc-name">{nodeData.label.toUpperCase()}</span>
          {nodeData.isHub && <span className="vpc-badge hub">HUB</span>}
          {nodeData.isEndpoint && <span className="vpc-badge endpoint">ENDPOINT</span>}
        </div>
        <div className="vpc-cidr-box">
          <span className="vpc-cidr">{nodeData.cidr}</span>
        </div>
      </div>
      {nodeData.accounts && nodeData.accounts.length > 0 && (
        <div className="vpc-accounts">
          <span className="accounts-label">RAM共享账号:</span>
          {nodeData.accounts.map((acc, i) => (
            <span key={i} className="account-id">{acc}</span>
          ))}
        </div>
      )}
      {hasComponents && (
        <div className="vpc-components">
          {nodeData.hasIgw && (
            <span className="component-tag igw">
              <Globe size={10} /> IGW
            </span>
          )}
          {nodeData.hasNfw && (
            <span className="component-tag nfw">
              <Shield size={10} /> NFW
            </span>
          )}
          {nodeData.hasGwlb && (
            <span className="component-tag gwlb">
              <Server size={10} /> GWLB
            </span>
          )}
          {nodeData.hasNat && (
            <span className="component-tag nat">
              <ArrowUpDown size={10} /> NAT
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} id="source-right" />
    </div>
  );
});

VpcNode.displayName = 'VpcNode';
export default VpcNode;
