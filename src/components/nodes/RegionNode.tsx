import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Globe2 } from 'lucide-react';

interface RegionNodeData {
  label: string;
  isMain?: boolean;
  isPeer?: boolean;
}

const RegionNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as RegionNodeData;
  return (
    <div className={`region-node ${nodeData.isMain ? 'region-main' : 'region-peer'}`}>
      <div className="region-header">
        <Globe2 size={18} />
        <span className="region-name">{nodeData.label}</span>
        {nodeData.isMain && <span className="region-badge main">PRIMARY</span>}
        {nodeData.isPeer && <span className="region-badge peer">PEER</span>}
      </div>
    </div>
  );
});

RegionNode.displayName = 'RegionNode';
export default RegionNode;
