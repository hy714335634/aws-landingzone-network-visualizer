import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { ArrowUpDown, Server } from 'lucide-react';

interface AzNodeData {
  az: string;
  azLabel: string;
  hasNat?: boolean;
  isPublicAz?: boolean;
}

const AzNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as AzNodeData;

  return (
    <div className={`az-node ${nodeData.isPublicAz ? 'az-public' : ''}`}>
      <div className="az-header">
        <Server size={12} />
        <span>可用区 {nodeData.azLabel}</span>
        <div className="az-components">
          {nodeData.hasNat && (
            <span className="component-tag nat">
              <ArrowUpDown size={10} /> NAT
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

AzNode.displayName = 'AzNode';
export default AzNode;
