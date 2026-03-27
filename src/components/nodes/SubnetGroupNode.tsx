import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Globe, ArrowUpDown, Server, Lock } from 'lucide-react';

interface SubnetGroupNodeData {
  label: string;
  typeName: string;
  isPublic?: boolean;
  isInternal?: boolean;
  hasIgw?: boolean;
  hasNat?: boolean;
}

const SubnetGroupNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as SubnetGroupNodeData;
  
  const getBgColor = () => {
    if (nodeData.isPublic) return 'rgba(34, 197, 94, 0.08)';
    if (nodeData.isInternal) return 'rgba(99, 102, 241, 0.08)';
    return 'rgba(59, 130, 246, 0.08)';
  };

  const getBorderColor = () => {
    if (nodeData.isPublic) return '#22c55e';
    if (nodeData.isInternal) return '#6366f1';
    return '#3b82f6';
  };

  const getIcon = () => {
    if (nodeData.isPublic) return <Globe size={14} />;
    if (nodeData.isInternal) return <Server size={14} />;
    return <Lock size={14} />;
  };

  return (
    <div 
      className="subnet-group-node"
      style={{ 
        backgroundColor: getBgColor(),
        borderColor: getBorderColor(),
      }}
    >
      <div className="subnet-group-header" style={{ borderBottomColor: getBorderColor() }}>
        <div className="subnet-group-title" style={{ color: getBorderColor() }}>
          {getIcon()}
          <span>{nodeData.label}</span>
        </div>
        <div className="subnet-group-components">
          {nodeData.hasIgw && (
            <span className="component-tag igw">
              <Globe size={11} /> IGW
            </span>
          )}
          {nodeData.hasNat && (
            <span className="component-tag nat">
              <ArrowUpDown size={11} /> NAT
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

SubnetGroupNode.displayName = 'SubnetGroupNode';
export default SubnetGroupNode;
